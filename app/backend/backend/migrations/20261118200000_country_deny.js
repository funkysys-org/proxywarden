import { migrate as logger } from "../logger.js";

const migrateName = "country_deny";

/**
 * Migrate
 *
 * Adds the optional country_deny JSON column to proxy hosts and static
 * hosts: a list of ISO 3166-1 alpha-2 codes denied at the door. The
 * geoip2 lookup itself is armed by the s6 oneshot when the operator drops
 * a GeoLite2 Country DB at /data/geoip/ — without the DB the field is
 * stored but dormant.
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
			proxy_host.json("country_deny").nullable().defaultTo(null);
		})
		.then(() => {
			logger.info(`[${migrateName}] proxy_host Table altered`);

			return knex.schema.table("static_host", (static_host) => {
				static_host.json("country_deny").nullable().defaultTo(null);
			});
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
