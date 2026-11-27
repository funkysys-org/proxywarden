import fs from "node:fs/promises";
import errs from "../lib/error.js";
import staticHostModel from "../models/static_host.js";
import internalNginx from "./nginx.js";

/**
 * Static-host WAF toggle (Wave 024): the per-host WAF OFF mechanism.
 *
 * Design notes (spike-proven 2026-11-24 on the real engine + real CRS):
 * - `SecRuleEngine Off` inline in a server block is ACCEPTED at parse time
 *   but IGNORED at runtime: the connector fixes the engine mode at init.
 *   A per-host OFF via the template is therefore impossible.
 * - The supported mechanism is the transaction-scope control:
 *   `ctl:ruleEngine=Off` on a phase-1 rule matched on the Host header.
 *   Zero extra memory (the global engine instance stays single), a true
 *   OFF (the CRS never evaluates the host's transactions), official
 *   modsec semantics.
 *
 * The panel manages a marked block in rules-before.conf — the same
 * strip-and-recompose pattern the WAF tuning uses for its PARANOIA block
 * (disjoint markers, so the two managers coexist in the same file without
 * ever rewriting each other). Every regeneration is gated: nginx -t runs
 * before the signal and the prior bytes are restored on failure
 * (fail-closed AND fail-restored — no frozen nginx).
 *
 * Rule ids: 100000 + host id — outside the CRS range (900xxx-999xxx),
 * deterministic per host, collision-free across regenerations.
 */

const MODSEC_DIR = "/data/modsec";
const RULES_BEFORE = `${MODSEC_DIR}/rules-before.conf`;
const WAF_OFF_BEGIN = "# BEGIN PROXYWARDEN STATIC WAF-OFF";
const WAF_OFF_END = "# END PROXYWARDEN STATIC WAF-OFF";

const escapeHostForRx = (domain) => domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const internalStaticWaf = {
	/**
	 * Regenerates the STATIC WAF-OFF marked block in rules-before.conf
	 * from the current static hosts (waf_enabled = 0), then reloads.
	 * No-op when the composed content did not change.
	 */
	syncRules: async () => {
		const offHosts = await staticHostModel
			.query()
			.where("waf_enabled", 0)
			.where("is_deleted", 0)
			.where("enabled", 1)
			.orderBy("id");

		let prevBefore = null;
		try {
			prevBefore = await fs.readFile(RULES_BEFORE, "utf8");
		} catch {
			// not seeded yet — the tuning manager seeds it on its first save
		}

		const lines = [WAF_OFF_BEGIN];
		for (const host of offHosts) {
			for (const domain of host.domain_names || []) {
				// The Host header carries an optional :port — the regex covers
				// both forms; the domain's dots are escaped.
				const rx = escapeHostForRx(domain);
				lines.push(
					`SecRule REQUEST_HEADERS:Host "@rx ^${rx}(:[0-9]+)?$" "id:${100000 + host.id},phase:1,pass,nolog,ctl:ruleEngine=Off"`,
				);
			}
		}
		lines.push(WAF_OFF_END);
		const block = lines.join("\n");

		// Strip-and-recompose: keep everything else (the PARANOIA block, the
		// hand edits), swap only OUR marked block.
		const stripRe = new RegExp(`\\n?${WAF_OFF_BEGIN}[\\s\\S]*?${WAF_OFF_END}\\n?`, "g");
		const body = (prevBefore || "").replace(stripRe, "\n").trim();
		const composed = [body, block].filter(Boolean).join("\n");

		if (composed === prevBefore) {
			return; // nothing changed — no save, no reload
		}

		await fs.writeFile(RULES_BEFORE, `${composed}\n`, "utf8");

		// The gate: the stock reload() runs nginx -t BEFORE the signal; on
		// failure the prior bytes are restored (fail-closed AND restored).
		try {
			await internalNginx.reload();
		} catch (err) {
			try {
				if (prevBefore !== null) {
					await fs.writeFile(RULES_BEFORE, prevBefore, "utf8");
				} else {
					await fs.rm(RULES_BEFORE, { force: true });
				}
			} catch {
				// best-effort restore — the error below is the real one
			}
			throw err;
		}
	},
};

export default internalStaticWaf;
