import { migrate as logger } from "../logger.js";

const migrateName = "static_host";

/**
 * Migrate
 *
 * @param   {Object} knex
 * @returns {Promise}
 */
const up = (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	return knex
		.raw("select 1")
		.then(() => {
			return knex.schema.createTable("static_host", (table) => {
				table.increments().primary();
				table.dateTime("created_on").notNull();
				table.dateTime("modified_on").notNull();
				table.integer("owner_user_id").notNull().unsigned();
				table.integer("is_deleted").notNull().unsigned().defaultTo(0);
				table.json("domain_names").notNull();
				table.integer("certificate_id").notNull().unsigned().defaultTo(0);
				table.integer("ssl_forced").notNull().unsigned().defaultTo(0);
				table.integer("hsts_enabled").notNull().unsigned().defaultTo(0);
				table.integer("hsts_subdomains").notNull().unsigned().defaultTo(0);
				table.text("advanced_config").notNull().defaultTo("");
				table.json("meta").notNull();
				table.integer("http2_support").notNull().unsigned().defaultTo(0);
				table.integer("enabled").notNull().unsigned().defaultTo(1);
				table.text("content").notNull().defaultTo("");
			});
		})
		.then(() => {
			return knex.schema.alterTable("user_permission", (table) => {
				table.string("static_hosts").notNull().defaultTo("hide");
			});
		})
		.then(() => {
			logger.info(`[${migrateName}] static_host Table created (user_permission.static_hosts added)`);
		});
};

/**
 * Undo Migrate
 *
 * @param   {Object} knex
 * @returns {Promise}
 */
const down = (knex) => {
	logger.info(`[${migrateName}] Migrating Down...`);

	return knex.schema
		.dropTable("static_host")
		.then(() => {
			return knex.schema.alterTable("user_permission", (table) => {
				table.dropColumn("static_hosts");
			});
		})
		.then(() => {
			logger.info(`[${migrateName}] static_host Table dropped (user_permission.static_hosts removed)`);
		});
};

export { up, down };
