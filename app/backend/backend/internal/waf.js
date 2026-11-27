import fs from "node:fs/promises";
import errs from "../lib/error.js";
import proxyHostModel, { scopeToOwnerOrAllowed } from "../models/proxy_host.js";
import redirectionHostModel from "../models/redirection_host.js";
import deadHostModel from "../models/dead_host.js";
import staticHostModel from "../models/static_host.js";
import internalNginx from "./nginx.js";

/**
 * Proxywarden WAF tuning (Wave 3): the panel-side replacement for the
 * canary-runbook CLI. Exclusions (SecRuleRemoveById) live in
 * /data/modsec/rules-after.conf — the same file both engine modes include —
 * and the CRS paranoia level is a marked block in rules-before.conf
 * (strip-and-recompose, so re-saving can never duplicate directives).
 *
 * Both endpoints are gated with the settings permission family: the WAF
 * tuning UI lives in Settings, and it is panel configuration, not a host.
 */

const MODSEC_DIR = "/data/modsec";
const RULES_AFTER = `${MODSEC_DIR}/rules-after.conf`;
const RULES_BEFORE = `${MODSEC_DIR}/rules-before.conf`;
const AUDIT_LOG = "/data/logs/modsec_audit.log";
const PARANOIA_BEGIN = "# BEGIN PROXYWARDEN PARANOIA";
const PARANOIA_END = "# END PROXYWARDEN PARANOIA";
const AFTER_HEADER = "# custom rules/exclusions evaluated AFTER CRS (managed by the WAF tuning UI — hand edits below the marker are preserved)";
const BEFORE_HEADER = "# custom rules evaluated BEFORE CRS (paranoia block managed by the WAF tuning UI)";

const internalWaf = {
	/**
	 * Reads the current tuning state.
	 *
	 * @param   {Object}  access
	 * @returns {Promise<Object>}  {exclusions: [{id, note?}], paranoia_level}
	 */
	getTuning: async (access) => {
		await access.can("settings:get");

		const exclusions = [];
		let after = "";
		try {
			after = await fs.readFile(RULES_AFTER, "utf8");
		} catch {
			// not seeded yet — empty state
		}
		const lines = after.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const m = lines[i].match(/^SecRuleRemoveById\s+(\d+)\s*;/);
			if (m) {
				// an optional note comment on the line above
				let note;
				const noteMatch = (lines[i - 1] || "").match(/^#\s*(.+)$/);
				if (noteMatch) {
					note = noteMatch[1].trim();
				}
				exclusions.push({ id: parseInt(m[1], 10), note });
			}
		}

		let paranoiaLevel = 1;
		let before = "";
		try {
			before = await fs.readFile(RULES_BEFORE, "utf8");
		} catch {
			// not seeded yet — default
		}
		const pl = before.match(/setvar:tx\.blocking_paranoia_level=(\d+)/);
		if (pl) {
			paranoiaLevel = parseInt(pl[1], 10);
		}

		return { exclusions, paranoia_level: paranoiaLevel };
	},

	/**
	 * Writes exclusions and/or the paranoia level, then reloads nginx so
	 * both engine modes pick the new files up.
	 *
	 * @param   {Object}  access
	 * @param   {Object}  payload   {exclusions: [{id, note?}], paranoia_level}
	 * @returns {Promise<Object>}   the new state
	 */
	updateTuning: async (access, payload) => {
		await access.can("settings:update");

		const exclusions = Array.isArray(payload.exclusions) ? payload.exclusions : [];
		const paranoiaLevel = typeof payload.paranoia_level === "number" ? payload.paranoia_level : 1;

		if (paranoiaLevel < 1 || paranoiaLevel > 4) {
			throw new errs.ConfigurationError("Paranoia level must be between 1 and 4");
		}

		// Validate BEFORE writing: every exclusion is a numeric CRS rule id
		const seen = new Set();
		for (const e of exclusions) {
			if (!e || !Number.isInteger(e.id) || e.id < 10000 || e.id > 999999) {
				throw new errs.ConfigurationError(`Invalid rule id: ${e?.id}`);
			}
			if (seen.has(e.id)) {
				throw new errs.ConfigurationError(`Duplicate rule id: ${e.id}`);
			}
			seen.add(e.id);
		}

		// Compose rules-after.conf: header + one SecRuleRemoveById per entry
		// (capture the prior bytes first — the reload gate below restores
		// them if the new config fails nginx -t: fail-closed AND restored)
		let prevAfter = null;
		try {
			prevAfter = await fs.readFile(RULES_AFTER, "utf8");
		} catch {
			// not seeded yet
		}
		const afterLines = [AFTER_HEADER];
		for (const e of exclusions) {
			if (e.note && typeof e.note === "string" && e.note.trim()) {
				afterLines.push(`# ${e.note.trim().replace(/\n/g, " ")}`);
			}
			afterLines.push(`SecRuleRemoveById ${e.id};`);
		}
		await fs.writeFile(RULES_AFTER, `${afterLines.join("\n")}\n`, "utf8");

		// Compose rules-before.conf: keep hand-edited content, swap only the
		// marked block (strip-and-recompose — re-saving never duplicates).
		let before = "";
		try {
			before = await fs.readFile(RULES_BEFORE, "utf8");
		} catch {
			// seeded below
		}
		const prevBefore = before || null;
		const block = [
			PARANOIA_BEGIN,
			// Canonical CRS form (crs-setup convention): a SecAction MUST NOT
			// carry a trailing ';' inside the quoted actions — the parser
			// treats it as an action separator and rejects the file. The id
			// sits in the CRS-reserved 900xxx range; crs-setup.conf ships it
			// commented, so no duplicate.
			`SecAction "id:900990,phase:1,pass,nolog,setvar:tx.blocking_paranoia_level=${paranoiaLevel}"`,
			PARANOIA_END,
		].join("\n");
		const stripRe = new RegExp(`\\n?${PARANOIA_BEGIN}[\\s\\S]*?${PARANOIA_END}\\n?`, "g");
		let body = before.replace(stripRe, "\n");
		// Drop the stale seed header comment so it can't accumulate
		body = body.replace(/^# custom rules evaluated BEFORE CRS[^\n]*\n?/gm, "");
		body = body.trim();
		// No prose header in the generated file: a comment line above the block
		// accumulated across re-saves (the legacy strip regex did not match the
		// parenthetical form) and produced a phantom 5th line that some parse
		// contexts rejected while every isolated test passed. The block markers
		// carry all the identity the compose needs; the seed's own header is
		// stripped on the first save by the tolerant regex below.
		const composed = [block, body].filter(Boolean).join("\n");
		await fs.writeFile(RULES_BEFORE, `${composed}\n`, "utf8");

		// Both engine modes include these files. The stock reload() runs
		// nginx -t BEFORE the signal: a bad directive throws here — and the
		// catch RESTORES the previous bytes so the engine keeps the last
		// good config (fail-closed AND fail-restored: no frozen nginx).
		try {
			await internalNginx.reload();
		} catch (err) {
			try {
				if (prevAfter !== null) {
					await fs.writeFile(RULES_AFTER, prevAfter, "utf8");
				} else {
					await fs.rm(RULES_AFTER, { force: true });
				}
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

		return internalWaf.getTuning(access);
	},

	/**
	 * Aggregates the recent WAF audit log (JSON format, one event per line)
	 * into counters: flagged/blocked totals, per-host, per-rule, per-source.
	 * Tolerant by design: every field is optional at parse time, so a format
	 * drift degrades counts instead of crashing the endpoint.
	 *
	 * Scoping mirrors the metrics report: non-admin users only see events
	 * for hosts they own (or are allowed) across the four host families.
	 *
	 * @param   {Object}  access
	 * @returns {Promise<Object>}
	 */
	getWafReport: async (access) => {
		const access_data = await access.can("reports:hosts", 1);
		const userId = access.token.getUserId(1);
		const isAdmin = access.isAdmin?.() || access_data.permission_visibility === "all";

		let allowedDomains = null; // null = unrestricted
		if (!isAdmin) {
			const permissionsMeta = access.getPermissions?.()?.meta;
			const proxyQuery = proxyHostModel.query().where("is_deleted", 0);
			scopeToOwnerOrAllowed(proxyQuery, userId, permissionsMeta);
			const redirectionQuery = redirectionHostModel.query().where("is_deleted", 0).andWhere("owner_user_id", userId);
			const deadQuery = deadHostModel.query().where("is_deleted", 0).andWhere("owner_user_id", userId);
			const staticQuery = staticHostModel.query().where("is_deleted", 0).andWhere("owner_user_id", userId);
			const [proxies, redirections, deads, statics] = await Promise.all([
				proxyQuery.select("domain_names"),
				redirectionQuery.select("domain_names"),
				deadQuery.select("domain_names"),
				staticQuery.select("domain_names"),
			]);
			allowedDomains = new Set(
				[...proxies, ...redirections, ...deads, ...statics]
					.flatMap((r) => r.domain_names || [])
					.map((d) => d.toLowerCase()),
			);
		}

		// Bounded tail read: the last 512 KB of audit events is plenty for a
		// live picture and keeps the endpoint cheap regardless of log size.
		let raw = "";
		let partialFirst = false;
		try {
			const stat = await fs.stat(AUDIT_LOG);
			const start = Math.max(0, stat.size - 512 * 1024);
			partialFirst = start > 0;
			const handle = await fs.open(AUDIT_LOG, "r");
			try {
				const buf = Buffer.alloc(stat.size - start);
				await handle.read(buf, 0, buf.length, start);
				raw = buf.toString("utf8");
			} finally {
				await handle.close();
			}
		} catch {
			// no audit log yet — empty report
			return {
				flagged: 0,
				blocked: 0,
				perHost: {},
				perRule: {},
				perSource: {},
				lastEvent: null,
			};
		}

		let blockedTotal = 0;
		const perHost = {};
		const perRule = {};
		const perSource = {};
		let lastEvent = null;

		// When the tail window started mid-line, the first line is a partial
		// event — skip it.
		const lines = raw.split("\n");
		if (partialFirst) {
			lines.shift();
		}
		let total = 0;
		for (const line of lines) {
			const t = line.trim();
			if (!t.startsWith("{")) continue;
			let ev;
			try {
				ev = JSON.parse(t);
			} catch {
				continue;
			}

			// libmodsecurity v3's JSON audit nests EVERYTHING inside
			// "transaction": request{}, response{} (with http_code, NOT
			// status) and messages[] whose rule id is details.ruleId.
			// Empirically pinned on the spike bench's real audit lines;
			// the top-level/legacy shapes stay as fallbacks.
			const tr = ev.transaction || {};
			const req = tr.request || ev.request || {};
			const res = tr.response || ev.response || {};

			const host = String(req?.headers?.Host || req?.headers?.host || "").toLowerCase();
			if (allowedDomains && !allowedDomains.has(host)) continue;

			const status = Number(res?.status ?? res?.http_code) || 0;
			const messages = [
				...(Array.isArray(tr.messages) ? tr.messages : []),
				...(Array.isArray(ev.messages) ? ev.messages : []),
				...(ev.audit_data?.messages || []),
				...(ev.audit_data?.error_messages || []),
			];
			const ruleIds = [];
			for (const m of messages) {
				if (m && typeof m === "object") {
					const rid = m?.details?.ruleId || m?.details?.id;
					if (rid) {
						const id = String(rid);
						if (!ruleIds.includes(id)) ruleIds.push(id);
					}
					// belt: the human-readable text may still carry [id "N"]
					for (const match of String(m.message || "").matchAll(/\[id "(\d+)"\]/g)) {
						const id = match[1];
						if (!ruleIds.includes(id)) ruleIds.push(id);
					}
				} else {
					for (const match of String(m).matchAll(/\[id "(\d+)"\]/g)) {
						const id = match[1];
						if (!ruleIds.includes(id)) ruleIds.push(id);
					}
				}
			}

			total++;
			const isBlocked = status >= 400 && ruleIds.length > 0;
			if (isBlocked) blockedTotal++;
			if (host) {
				perHost[host] = perHost[host] || { flagged: 0, blocked: 0 };
				perHost[host].flagged++;
				if (isBlocked) perHost[host].blocked++;
			}
			for (const id of ruleIds) {
				perRule[id] = (perRule[id] || 0) + 1;
			}
			const src = ev.transaction?.remote_address || ev.transaction?.client_ip;
			if (src) {
				perSource[src] = (perSource[src] || 0) + 1;
			}
			const time = ev.transaction?.time || ev.transaction?.time_stamp;
			if (time) lastEvent = time;
		}

		const topRules = Object.entries(perRule)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([id, count]) => ({ id: Number(id), count }));

		return {
			flagged: total,
			blocked: blockedTotal,
			perHost,
			perRule: topRules,
			perSource,
			lastEvent,
		};
	},
};

export default internalWaf;
