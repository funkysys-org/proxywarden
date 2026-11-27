import { migrate as logger } from "../logger.js";

const migrateName = "max_body_size";

/**
 * Migrate
 *
 * Adds the optional max_body_size to proxy hosts (nginx size, e.g. "32m").
 * When set, the host config carries client_max_body_size so large uploads
 * stop dying at the default 1m without a blanket change.
 *
 * @see http://knexjs.org/#Schema
 *
 * @param   {Object}  knex
 * @returns {Promise}
 */
const up = (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	return knex.schema
		.table("proxy_host", (proxy_host) => {
			proxy_host.text("max_body_size").nullable().defaultTo(null);
		})
		.then(() => {
			logger.info(`[${migrateName}] proxy_host Table altered`);
		});
};

/**
 * Undo Migrate
 *
 * @param   {Object}  knex
 * @returns {Promise}
 */
const down = (_knex) => {
	logger.warn(`[${migrateName}] You can't migrate down this one.`);
	return Promise.resolve(true);
};

export { up, down };
