import http from "node:http";
import errs from "../lib/error.js";
import proxyHostModel, { scopeToOwnerOrAllowed } from "../models/proxy_host.js";
import redirectionHostModel from "../models/redirection_host.js";
import deadHostModel from "../models/dead_host.js";
import staticHostModel from "../models/static_host.js";

const adminPort = Number.parseInt(process.env.NPM_ADMIN_PORT || "81", 10);

/**
 * Fetches the vts JSON from the admin nginx listener. The location is
 * 127.0.0.1-only by design (see production.conf.template), so this is a
 * container-internal hop: no vts data is ever exposed without the JWT gate
 * of the API route that calls this.
 *
 * @returns {Promise<Object>}
 */
const fetchVtsJson = () => {
	return new Promise((resolve, reject) => {
		const req = http.get(
			{
				host: "127.0.0.1",
				port: adminPort,
				path: "/vts_status/format/json",
				timeout: 3000,
			},
			(res) => {
				let body = "";
				res.on("data", (chunk) => {
					body += chunk;
				});
				res.on("end", () => {
					if (res.statusCode !== 200) {
						reject(new errs.ConfigurationError(`vts status returned ${res.statusCode}`));
						return;
					}
					try {
						resolve(JSON.parse(body));
					} catch (err) {
						reject(err);
					}
				});
			},
		);
		req.on("timeout", () => {
			req.destroy();
			reject(new errs.ConfigurationError("vts status fetch timed out"));
		});
		req.on("error", (err) => {
			reject(err);
		});
	});
};

const internalMetrics = {
	/**
	 * GET /reports/metrics
	 *
	 * vts per-host traffic stats, scoped by the caller's host visibility:
	 * admins (and the `all` visibility) get every zone; anyone else gets
	 * only the zones matching the domain_names of hosts they own or have
	 * been allowed via the permission meta (proxy_host_ids) — the same
	 * scoping semantics as the host lists themselves.
	 *
	 * @param   {Access}   access
	 * @returns {Promise}
	 */
	getMetricsReport: (access) => {
		return access.can("reports:hosts", 1).then(async (access_data) => {
			const userId = access.token.getUserId(1);
			const isAdmin = access.isAdmin?.() || access_data.permission_visibility === "all";

			let allowedDomains = null; // null = unrestricted (admin / visibility all)
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

				allowedDomains = new Set();
				[proxies, redirections, deads, statics].forEach((rows) => {
					rows.forEach((row) => {
						(row.domain_names || []).forEach((domain) => allowedDomains.add(domain));
					});
				});
			}

			const vts = await fetchVtsJson();
			const zones = vts?.serverZones || {};
			const serverZones = {};
			Object.keys(zones).forEach((zone) => {
				if (allowedDomains && !allowedDomains.has(zone)) {
					return;
				}
				serverZones[zone] = zones[zone];
			});

			return {
				generatedAt: new Date().toISOString(),
				visibility: isAdmin ? "all" : "user",
				serverZones,
			};
		});
	},
};

export default internalMetrics;
