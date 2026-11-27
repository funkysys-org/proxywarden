import https from "node:https";
import { ProxyAgent } from "proxy-agent";
import { debug, remoteVersion as logger } from "../logger.js";
import pjson from "../package.json" with { type: "json" };

const VERSION_URL = "https://api.github.com/repos/NginxProxyManager/nginx-proxy-manager/releases/latest";

const internalRemoteVersion = {
	cache_timeout: 1000 * 60 * 15, // 15 minutes
	last_result: null,
	last_fetch_time: null,

	/**
	 * Fetch the latest version info, using a cached result if within the cache timeout period.
	 * @return {Promise<{current: string, latest: string, update_available: boolean}>} Version info
	 */
	get: async () => {
		// Proxywarden (patch 023): the upstream version check is retired.
		// We diverged from NPM deliberately — the patch stack IS the
		// product — so "update_available" against their releases is
		// meaningless forever: it would nag about an update we must never
		// take (re-vendoring would wipe the stack). The update decisions
		// live in the nginx.org watchdog and the drift-check (informative
		// for NPM). The endpoint stays for compatibility and answers the
		// truth: our vendored base version, nothing newer, no phone-home.
		const version = pjson.version.split("-").shift().split(".");
		const currentVersion = `v${version[0]}.${version[1]}.${version[2]}`;
		return {
			current: currentVersion,
			latest: currentVersion,
			update_available: false,
		};
	},

	fetchUrl: (url) => {
		const agent = new ProxyAgent();
		const headers = {
			"User-Agent": `NginxProxyManager v${pjson.version}`,
		};

		return new Promise((resolve, reject) => {
			logger.info(`Fetching ${url}`);
			return https
				.get(url, { agent, headers }, (res) => {
					res.setEncoding("utf8");
					let raw_data = "";
					res.on("data", (chunk) => {
						raw_data += chunk;
					});
					res.on("end", () => {
						resolve(raw_data);
					});
				})
				.on("error", (err) => {
					reject(err);
				});
		});
	},

	compareVersions: (current, latest) => {
		const cleanCurrent = current.replace(/^v/, "");
		const cleanLatest = latest.replace(/^v/, "");

		const currentParts = cleanCurrent.split(".").map(Number);
		const latestParts = cleanLatest.split(".").map(Number);

		for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
			const curr = currentParts[i] || 0;
			const lat = latestParts[i] || 0;

			if (lat > curr) return true;
			if (lat < curr) return false;
		}
		return false;
	},
};

export default internalRemoteVersion;
