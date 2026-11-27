import _ from "lodash";
import { mkdir, rm, writeFile } from "node:fs/promises";
import errs from "../lib/error.js";
import { castJsonIfNeed } from "../lib/helpers.js";
import utils from "../lib/utils.js";
import staticHostModel from "../models/static_host.js";
import internalAuditLog from "./audit-log.js";
import internalCertificate from "./certificate.js";
import internalHost from "./host.js";
import internalNginx from "./nginx.js";
import internalStaticWaf from "./static-waf.js";

const omissions = () => {
	return ["is_deleted"];
};

const internalStaticHost = {
	/**
	 * (Re)writes the on-disk content file served by nginx. The DB is the
	 * source of truth; this file is a derived artifact, regenerated on
	 * every create/update/enable. The nginx template only points `root`
	 * at the directory — if this file is ever missing, try_files yields
	 * 404 instead of crashing, so a deleted file degrades, never breaks.
	 *
	 * @param   {Object}  row
	 * @returns {Promise}
	 */
	writeContentFile: async (row) => {
		// A host with document_root serves a real filesystem tree the
		// operator mounted — the derived file is NOT written (and never
		// clobbered); nginx roots at document_root directly.
		if (row.document_root) {
			return;
		}
		const dir = `/data/nginx/static_host/${row.id}`;
		await mkdir(dir, { recursive: true });
		await writeFile(`${dir}/index.html`, typeof row.content === "string" ? row.content : "", { encoding: "utf8" });
	},

	/**
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @returns {Promise}
	 */
	create: async (access, data) => {
		const createCertificate = data.certificate_id === "new";

		if (createCertificate) {
			delete data.certificate_id;
		}

		await access.can("static_hosts:create", data);

		// Get a list of the domain names and check each of them against existing records
		const domainNameCheckPromises = [];

		data.domain_names.map((domain_name) => {
			domainNameCheckPromises.push(internalHost.isHostnameTaken(domain_name));
			return true;
		});

		await Promise.all(domainNameCheckPromises).then((check_results) => {
			check_results.map((result) => {
				if (result.is_taken) {
					throw new errs.ValidationError(`${result.hostname} is already in use`);
				}
				return true;
			});
		});

		// At this point the domains should have been checked
		data.owner_user_id = access.token.getUserId(1);
		const thisData = internalHost.cleanSslHstsData(data);

		// Wave 025: a whitelist with an empty list would block every visitor
		// once geoip2 arms the block — refuse it before anything is stored.
		internalHost.assertCountryListCoherent(thisData);

		// Fix for db field not having a default value
		// for this optional field.
		if (typeof data.advanced_config === "undefined") {
			thisData.advanced_config = "";
		}
		if (typeof thisData.content === "undefined") {
			thisData.content = "";
		}

		internalHost.assertAdvancedConfigAllowed(access, thisData);

		const row = await staticHostModel.query().insertAndFetch(thisData).then(utils.omitRow(omissions()));

		// Add to audit log
		await internalAuditLog.add(access, {
			action: "created",
			object_type: "static-host",
			object_id: row.id,
			meta: thisData,
		});

		if (createCertificate) {
			const cert = await internalCertificate.createQuickCertificate(access, data);

			// update host with cert id
			await internalStaticHost.update(access, {
				id: row.id,
				certificate_id: cert.id,
			});
		}

		// re-fetch with cert
		const freshRow = await internalStaticHost.get(access, {
			id: row.id,
			expand: ["certificate", "owner"],
		});

		// Sanity check
		if (createCertificate && !freshRow.certificate_id) {
			throw new errs.InternalValidationError("The host was created but the Certificate creation failed.");
		}

		// Write the content file BEFORE nginx renders the config that points at it
		await internalStaticHost.writeContentFile(freshRow);

		// Configure nginx
		await internalNginx.configure(staticHostModel, "static_host", freshRow);
		await internalStaticWaf.syncRules();

		return freshRow;
	},

	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {Number}  data.id
	 * @return {Promise}
	 */
	update: async (access, data) => {
		const createCertificate = data.certificate_id === "new";
		if (createCertificate) {
			delete data.certificate_id;
		}

		await access.can("static_hosts:update", data.id);

		// Get a list of the domain names and check each of them against existing records
		const domainNameCheckPromises = [];
		if (typeof data.domain_names !== "undefined") {
			data.domain_names.map((domainName) => {
				domainNameCheckPromises.push(internalHost.isHostnameTaken(domainName, "static", data.id));
				return true;
			});

			const checkResults = await Promise.all(domainNameCheckPromises);
			checkResults.map((result) => {
				if (result.is_taken) {
					throw new errs.ValidationError(`${result.hostname} is already in use`);
				}
				return true;
			});
		}
		const row = await internalStaticHost.get(access, { id: data.id });

		if (row.id !== data.id) {
			// Sanity check that something crazy hasn't happened
			throw new errs.InternalValidationError(
				`Static Host could not be updated, IDs do not match: ${row.id} !== ${data.id}`,
			);
		}

		// Before the certificate is created, so a refused request doesn't leave one behind
		internalHost.assertAdvancedConfigAllowed(access, data, row);

		if (createCertificate) {
			const cert = await internalCertificate.createQuickCertificate(access, {
				domain_names: data.domain_names || row.domain_names,
				meta: _.assign({}, row.meta, data.meta),
			});

			// update host with cert id
			data.certificate_id = cert.id;
		}

		// Add domain_names to the data in case it isn't there, so that the audit log renders correctly. The order is important here.
		let thisData = _.assign(
			{},
			{
				domain_names: row.domain_names,
			},
			data,
		);

		thisData = internalHost.cleanSslHstsData(thisData, row);

		// Wave 025 gate on the MERGED state: a mode-only update against a host
		// that already carries a list must pass; only an effectively-empty
		// whitelist is refused.
		internalHost.assertCountryListCoherent({
			country_list_mode:
				typeof data.country_list_mode !== "undefined" ? data.country_list_mode : row.country_list_mode,
			country_deny: Array.isArray(data.country_deny) ? data.country_deny : row.country_deny,
		});

		// do the row update
		await staticHostModel.query().where({ id: data.id }).patch(data);

		// Add to audit log
		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "static-host",
			object_id: row.id,
			meta: thisData,
		});

		const thisRow = await internalStaticHost.get(access, {
			id: thisData.id,
			expand: ["owner", "certificate"],
		});

		// Configure nginx
		if (!thisRow.enabled) {
			// No need to add nginx config if host is disabled
			return _.omit(internalHost.cleanRowCertificateMeta(thisRow), omissions());
		}

		// Content changed or not, regenerate the derived file — cheap and idempotent
		await internalStaticHost.writeContentFile(thisRow);

		await internalStaticWaf.syncRules();
		const newMeta = await internalNginx.configure(staticHostModel, "static_host", thisRow);
		thisRow.meta = newMeta;
		return _.omit(internalHost.cleanRowCertificateMeta(thisRow), omissions());
	},

	/**
	 * @param   {Access}   access
	 * @param   {Object}   data
	 * @param   {Number}   data.id
	 * @param   {Array}    [data.expand]
	 * @param   {Array}    [data.omit]
	 * @return  {Promise}
	 */
	get: async (access, data) => {
		const accessData = await access.can("static_hosts:get", data.id);
		const query = staticHostModel
			.query()
			.where("is_deleted", 0)
			.andWhere("id", data.id)
			.allowGraph(staticHostModel.defaultAllowGraph)
			.first();

		if (accessData.permission_visibility !== "all") {
			query.andWhere("owner_user_id", access.token.getUserId(1));
		}

		if (typeof data.expand !== "undefined" && data.expand !== null) {
			query.withGraphFetched(`[${data.expand.join(", ")}]`);
		}

		const row = await query.then(utils.omitRow(omissions()));
		if (!row?.id) {
			throw new errs.ItemNotFoundError(data.id);
		}
		// Custom omissions
		if (typeof data.omit !== "undefined" && data.omit !== null) {
			return _.omit(row, data.omit);
		}
		return row;
	},

	/**
	 * @param {Access}  access
	 * @param {Object}  data
	 * @param {Number}  data.id
	 * @param {String}  [data.reason]
	 * @returns {Promise}
	 */
	delete: async (access, data) => {
		await access.can("static_hosts:delete", data.id);
		const row = await internalStaticHost.get(access, { id: data.id });
		if (!row?.id) {
			throw new errs.ItemNotFoundError(data.id);
		}

		await staticHostModel.query().where("id", row.id).patch({
			is_deleted: 1,
		});

		// Delete Nginx Config
		await internalNginx.deleteConfig("static_host", row);

		// Remove the derived content directory too
		await rm(`/data/nginx/static_host/${row.id}`, { recursive: true, force: true });

		await internalNginx.reload();
		await internalStaticWaf.syncRules();

		// Add to audit log
		await internalAuditLog.add(access, {
			action: "deleted",
			object_type: "static-host",
			object_id: row.id,
			meta: _.omit(row, omissions()),
		});
		return true;
	},

	/**
	 * @param {Access}  access
	 * @param {Object}  data
	 * @param {Number}  data.id
	 * @param {String}  [data.reason]
	 * @returns {Promise}
	 */
	enable: async (access, data) => {
		await access.can("static_hosts:update", data.id);
		const row = await internalStaticHost.get(access, {
			id: data.id,
			expand: ["certificate", "owner"],
		});
		if (!row?.id) {
			throw new errs.ItemNotFoundError(data.id);
		}
		if (row.enabled) {
			throw new errs.ValidationError("Host is already enabled");
		}

		row.enabled = 1;

		await staticHostModel.query().where("id", row.id).patch({
			enabled: 1,
		});

		// Regenerate the content file (a delete/remove may have raced, and it's cheap)
		await internalStaticHost.writeContentFile(row);

		// Configure nginx
		await internalStaticWaf.syncRules();
		await internalNginx.configure(staticHostModel, "static_host", row);

		// Add to audit log
		await internalAuditLog.add(access, {
			action: "enabled",
			object_type: "static-host",
			object_id: row.id,
			meta: _.omit(row, omissions()),
		});
		return true;
	},

	/**
	 * @param {Access}  access
	 * @param {Object}  data
	 * @param {Number}  data.id
	 * @param {String}  [data.reason]
	 * @returns {Promise}
	 */
	disable: async (access, data) => {
		await access.can("static_hosts:update", data.id);
		const row = await internalStaticHost.get(access, { id: data.id });
		if (!row?.id) {
			throw new errs.ItemNotFoundError(data.id);
		}
		if (!row.enabled) {
			throw new errs.ValidationError("Host is already disabled");
		}

		row.enabled = 0;

		await staticHostModel.query().where("id", row.id).patch({
			enabled: 0,
		});

		// Delete Nginx Config
		await internalNginx.deleteConfig("static_host", row);
		await internalNginx.reload();

		// Add to audit log
		await internalAuditLog.add(access, {
			action: "disabled",
			object_type: "static-host",
			object_id: row.id,
			meta: _.omit(row, omissions()),
		});
		return true;
	},

	/**
	 * All Hosts
	 *
	 * @param   {Access}  access
	 * @param   {Array}   [expand]
	 * @param   {String}  [searchQuery]
	 * @returns {Promise}
	 */
	getAll: async (access, expand, searchQuery) => {
		const accessData = await access.can("static_hosts:list");
		const query = staticHostModel
			.query()
			.where("is_deleted", 0)
			.groupBy("id")
			.allowGraph(staticHostModel.defaultAllowGraph)
			.orderBy(castJsonIfNeed("domain_names"), "ASC");

		if (accessData.permission_visibility !== "all") {
			query.andWhere("owner_user_id", access.token.getUserId(1));
		}

		// Query is used for searching
		if (typeof searchQuery === "string" && searchQuery.length > 0) {
			query.where(function () {
				this.where(castJsonIfNeed("domain_names"), "like", `%${searchQuery}%`);
			});
		}

		if (typeof expand !== "undefined" && expand !== null) {
			query.withGraphFetched(`[${expand.join(", ")}]`);
		}

		const rows = await query.then(utils.omitRows(omissions()));
		if (typeof expand !== "undefined" && expand !== null && expand.indexOf("certificate") !== -1) {
			internalHost.cleanAllRowsCertificateMeta(rows);
		}
		return rows;
	},

	/**
	 * Report use
	 *
	 * @param   {Number}  user_id
	 * @param   {String}  visibility
	 * @returns {Promise}
	 */
	getCount: async (user_id, visibility) => {
		const query = staticHostModel.query().count("id as count").where("is_deleted", 0);

		if (visibility !== "all") {
			query.andWhere("owner_user_id", user_id);
		}

		const row = await query.first();
		return Number.parseInt(row.count, 10);
	},
};

export default internalStaticHost;
