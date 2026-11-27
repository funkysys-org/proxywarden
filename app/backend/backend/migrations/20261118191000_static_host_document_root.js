import { migrate as logger } from "../logger.js";

const migrateName = "static_host_document_root";

/**
 * Migrate
 *
 * Adds the optional document_root to static hosts: when set, the host
 * serves the given absolute filesystem path (a mounted tree) instead of
 * the inline content. The column is nullable and optional — unset means
 * the existing inline-content behavior.
 *
 * @see http://knexjs.org/#Schema
 *
 * @param   {Object}  knex
 * @returns {Promise}
 */
const up = (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	return knex.schema
		.table("static_host", (static_host) => {
			static_host.text("document_root").nullable().defaultTo(null);
		})
		.then(() => {
			logger.info(`[${migrateName}] static_host Table altered`);
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
