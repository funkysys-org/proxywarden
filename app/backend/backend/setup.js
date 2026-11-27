import { installPlugins } from "./lib/certbot.js";
import utils from "./lib/utils.js";
import { setup as logger } from "./logger.js";
import authModel from "./models/auth.js";
import certificateModel from "./models/certificate.js";
import settingModel from "./models/setting.js";
import userModel from "./models/user.js";
import userPermissionModel from "./models/user_permission.js";
import fs from "node:fs/promises";

export const isSetup = async () => {
	const row = await userModel.query().select("id").where("is_deleted", 0).first();
	return row?.id > 0;
};

/**
 * Creates a default admin users if one doesn't already exist in the database
 *
 * @returns {Promise}
 */
const setupDefaultUser = async () => {
	const initialAdminEmail = process.env.INITIAL_ADMIN_EMAIL;
	const initialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD;

	// This will only create a new user when there are no active users in the database
	// and the INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD environment variables are set.
	// Otherwise, users should be shown the setup wizard in the frontend.
	// I'm keeping this legacy behavior in case some people are automating deployments.

	if (!initialAdminEmail || !initialAdminPassword) {
		return Promise.resolve();
	}

	const userIsetup = await isSetup();
	if (!userIsetup) {
		// Create a new user and set password
		logger.info(`Creating a new user: ${initialAdminEmail} with password: ${initialAdminPassword}`);

		const data = {
			is_deleted: 0,
			email: initialAdminEmail,
			name: "Administrator",
			nickname: "Admin",
			avatar: "",
			roles: ["admin"],
		};

		const user = await userModel.query().insertAndFetch(data);

		await authModel.query().insert({
			user_id: user.id,
			type: "password",
			secret: initialAdminPassword,
			meta: {},
		});

		await userPermissionModel.query().insert({
			user_id: user.id,
			visibility: "all",
			proxy_hosts: "manage",
			redirection_hosts: "manage",
			dead_hosts: "manage",
			streams: "manage",
			access_lists: "manage",
			certificates: "manage",
		});
		logger.info("Initial admin setup completed");
	}
};

/**
 * Creates default settings if they don't already exist in the database
 *
 * @returns {Promise}
 */
const setupDefaultSettings = async () => {
	const row = await settingModel.query().select("id").where({ id: "default-site" }).first();

	if (!row?.id) {
		await settingModel.query().insert({
			id: "default-site",
			name: "Default Site",
			description: "What to show when Nginx is hit with an unknown Host",
			value: "congratulations",
			meta: {},
		});
		logger.info("Default settings added");
	}

	// Proxywarden LDAP authentication config (Phase A7). Seeded disabled; an
	// admin fills the server details in the Settings UI to turn it on.
	const ldapRow = await settingModel.query().select("id").where({ id: "ldap-auth" }).first();
	if (!ldapRow?.id) {
		await settingModel.query().insert({
			id: "ldap-auth",
			name: "LDAP Authentication",
			description: "Authenticate panel users against an LDAP/Active Directory server",
			value: "disabled",
			meta: {
				enabled: false,
				url: "",
				bind_dn: "",
				bind_password: "",
				base_dn: "",
				filter: "(uid={username})",
				starttls: false,
				provision_on_login: true,
				default_visibility: "user",
			},
		});
		logger.info("LDAP auth setting added");
	}

	// Proxywarden 2FA login policy (Wave 1). Seeded off: every non-admin
	// account must have 2FA configured to log in when enabled. Admins are
	// exempt — the switch can never lock the operator out.
	const policyRow = await settingModel.query().select("id").where({ id: "2fa-policy" }).first();
	if (!policyRow?.id) {
		await settingModel.query().insert({
			id: "2fa-policy",
			name: "2FA Policy",
			description: "Require two-factor authentication for non-admin logins",
			value: "disabled",
			meta: {
				enabled: false,
			},
		});
		logger.info("2FA policy setting added");
	}
};

/**
 * Installs all Certbot plugins which are required for an installed certificate
 *
 * @returns {Promise}
 */
const setupCertbotPlugins = async () => {
	const certificates = await certificateModel.query().where("is_deleted", 0).andWhere("provider", "letsencrypt");

	if (certificates?.length) {
		const plugins = [];

		certificates.map((certificate) => {
			if (certificate.meta && certificate.meta.dns_challenge === true) {
				if (plugins.indexOf(certificate.meta.dns_provider) === -1) {
					plugins.push(certificate.meta.dns_provider);
				}

				// Deliberately does NOT write the DNS credentials file here any more.
				//
				// It used to, so that a later `certbot renew` would find the path recorded in its
				// renewal config. The effect was that every backend restart rewrote a plaintext
				// DNS provider API token for every DNS-01 certificate, and left it there.
				//
				// internalCertificate now writes that file immediately before it runs certbot and
				// removes it again afterwards, so there is exactly one writer and the credential
				// is on disk only for the length of a certbot run. Recreating the files at boot
				// would put every one of them straight back.
			}
			return true;
		});

		await installPlugins(plugins);

		if (plugins.length) {
			logger.info(`Added Certbot plugins ${plugins.join(", ")}`);
		}
	}
};

/**
 * Starts a timer to call run the logrotation binary every two days
 * @returns {Promise}
 */
const setupLogrotation = () => {
	const intervalTimeout = 1000 * 60 * 60 * 24 * 2; // 2 days

	const runLogrotate = async () => {
		try {
			await utils.exec("logrotate /etc/logrotate.d/nginx-proxy-manager");
			logger.info("Logrotate completed.");
		} catch (e) {
			logger.warn(e);
		}
	};

	logger.info("Logrotate Timer initialized");
	setInterval(runLogrotate, intervalTimeout);
	// And do this now as well
	return runLogrotate();
};

export default () => setupDefaultUser().then(setupDefaultSettings).then(setupCertbotPlugins).then(setupLogrotation);
