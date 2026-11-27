import gravatar from "gravatar";
import { Client } from "ldapts";
import errs from "../lib/error.js";
import authModel from "../models/auth.js";
import settingModel from "../models/setting.js";
import userModel from "../models/user.js";
import userPermissionModel from "../models/user_permission.js";

/**
 * Proxywarden LDAP authentication.
 *
 * Config lives in the `ldap-auth` setting row (seeded at setup, edited from
 * the Settings UI by admins). The login flow (internal/token.js) tries the
 * LOCAL password first — LDAP being down can never lock out local accounts —
 * and falls back to an LDAP bind+search+bind when the local check fails.
 */

const DEFAULTS = {
	enabled: false,
	url: "",
	bind_dn: "",
	bind_password: "",
	base_dn: "",
	filter: "(uid={username})",
	starttls: false,
	provision_on_login: true,
	default_visibility: "user",
};

const internalLdap = {
	/**
	 * The effective config: the seeded defaults overlaid with whatever the
	 * admin saved in the setting row's meta.
	 *
	 * @returns {Promise<Object>}
	 */
	getConfig: async () => {
		const row = await settingModel.query().where({ id: "ldap-auth" }).first();
		return {
			...DEFAULTS,
			...(row?.meta || {}),
		};
	},

	/**
	 * Attempts an LDAP login: service-bind -> search the user's DN with the
	 * configured filter -> bind AS that DN with the supplied password.
	 * Resolves with {dn, mail, name} on success, rejects otherwise.
	 * Never throws a distinguishable error: callers turn any failure into the
	 * same generic invalid-auth response (no account enumeration).
	 *
	 * @param   {String}  username
	 * @param   {String}  password
	 * @returns {Promise<Object>}
	 */
	authenticate: async (username, password) => {
		const config = await internalLdap.getConfig();

		if (!config.enabled || !config.url || !config.base_dn || !password) {
			throw new errs.AuthError("LDAP is not enabled");
		}

		const client = new Client({
			url: config.url,
			timeout: 5000,
			connectTimeout: 5000,
		});

		try {
			if (config.starttls) {
				await client.startTLS();
			}

			// Service bind (optional: anonymous bind works on some servers)
			if (config.bind_dn) {
				await client.bind(config.bind_dn, config.bind_password || "");
			}

			// Search the user entry
			const filter = config.filter.replace("{username}", username.replace(/[\\()*\0]/g, ""));
			const { searchEntries } = await client.search(config.base_dn, {
				scope: "sub",
				filter,
			});

			if (!searchEntries || searchEntries.length === 0) {
				throw new errs.AuthError("LDAP user not found");
			}
			const entry = searchEntries[0];

			// Bind as the found DN with the supplied password: this IS the
			// authentication check.
			const userClient = new Client({
				url: config.url,
				timeout: 5000,
				connectTimeout: 5000,
			});
			try {
				if (config.starttls) {
					await userClient.startTLS();
				}
				await userClient.bind(entry.dn, password);
				await userClient.unbind();
			} catch (err) {
				throw new errs.AuthError("LDAP bind failed");
			}

			return {
				dn: entry.dn,
				mail: entry.mail || `${username}@ldap`,
				name: entry.cn || entry.name || username,
			};
		} finally {
			// Best-effort cleanup of the service connection
			try {
				await client.unbind();
			} catch {
				// already unbound / never bound
			}
		}
	},

	/**
	 * Returns the local user row for an LDAP-authenticated identity,
	 * creating it on first login (when provisioning is enabled) with the
	 * same shape the admin "create user" flow produces: user + auth(type=ldap)
	 * + permission row. LDAP-provisioned users never have a local password.
	 *
	 * @param   {Object}  access
	 * @param   {String}  email
	 * @param   {Object}  ldapUser   {dn, mail, name}
	 * @returns {Promise<Object>}    the user row
	 */
	provisionOrGet: async (email, ldapUser) => {
		const cleanEmail = email.toLowerCase().trim();

		const existing = await userModel
			.query()
			.where("email", cleanEmail)
			.andWhere("is_deleted", 0)
			.andWhere("is_disabled", 0)
			.first();

		if (existing) {
			return existing;
		}

		const config = await internalLdap.getConfig();
		if (!config.provision_on_login) {
			throw new errs.AuthError("Provisioning is disabled");
		}

		const user = await userModel.query().insertAndFetch({
			email: cleanEmail,
			name: ldapUser.name || cleanEmail,
			avatar: gravatar.url(cleanEmail, { default: "mm" }),
			roles: ["user"],
			is_disabled: 0,
		});

		// No local password for LDAP users: type=ldap, empty secret. The auth
		// model only hashes type=password secrets, so this stores as-is.
		await authModel.query().insert({
			user_id: user.id,
			type: "ldap",
			secret: "",
			meta: { dn: ldapUser.dn },
		});

		// Same permission shape the admin user-creation flow produces
		await userPermissionModel.query().insert({
			user_id: user.id,
			visibility: config.default_visibility,
			proxy_hosts: "manage",
			redirection_hosts: "manage",
			dead_hosts: "manage",
			static_hosts: "manage",
			streams: "manage",
			access_lists: "manage",
			certificates: "manage",
		});

		return user;
	},
};

export default internalLdap;
