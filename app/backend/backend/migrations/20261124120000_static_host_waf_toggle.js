import { migrate as logger } from "../logger.js";

const migrateName = "static_host_waf_toggle";

/**
 * Migrate
 *
 * Adds the per-host WAF and exploit toggles to static hosts:
 * - waf_enabled (default ON): when OFF, the panel writes a Host-matched
 *   ctl:ruleEngine=Off rule into the marked block of rules-before.conf
 *   (the mechanism spike-proven on the real engine: the transaction-scope
 *   engine toggle, zero extra memory, no template change).
 * - block_exploits (default OFF, the same default as the proxy hosts):
 *   the conditional include of the stock block-exploits if-chain.
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
			static_host.integer("waf_enabled").notNullable().defaultTo(1);
			static_host.integer("block_exploits").notNullable().defaultTo(0);
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
const down = (knex) => {
	logger.info(`[${migrateName}] Migrating Down...`);

	return knex.schema
		.table("static_host", (static_host) => {
			static_host.dropColumn("waf_enabled");
			static_host.dropColumn("block_exploits");
		})
		.then(() => {
			logger.info(`[${migrateName}] static_host Table altered`);
		});
};

export { up, down };
