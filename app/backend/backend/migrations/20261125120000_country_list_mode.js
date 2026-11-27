export async function up(knex) {
	await knex.schema.alterTable("proxy_host", (table) => {
		table.text("country_list_mode").notNullable().defaultTo("deny");
	});
	await knex.schema.alterTable("static_host", (table) => {
		table.text("country_list_mode").notNullable().defaultTo("deny");
	});
}

export async function down(knex) {
	await knex.schema.alterTable("proxy_host", (table) => {
		table.dropColumn("country_list_mode");
	});
	await knex.schema.alterTable("static_host", (table) => {
		table.dropColumn("country_list_mode");
	});
}
