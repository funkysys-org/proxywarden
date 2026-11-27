import express from "express";
import internalWaf from "../internal/waf.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import apiValidator from "../lib/validator/api.js";
import { debug, express as logger } from "../logger.js";
import { getValidationSchema } from "../schema/index.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

/**
 * /api/waf/report
 */
router
	.route("/report")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * GET /api/waf/report
	 *
	 * Recent WAF audit activity, aggregated and scoped like the metrics
	 */
	.get(async (req, res, next) => {
		try {
			const data = await internalWaf.getWafReport(res.locals.access);
			res.status(200).send(data);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * /api/waf/tuning
 */
router
	.route("/tuning")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * GET /api/waf/tuning
	 *
	 * Retrieve the current WAF tuning state (exclusions + paranoia level)
	 */
	.get(async (req, res, next) => {
		try {
			const data = await internalWaf.getTuning(res.locals.access);
			res.status(200).send(data);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	})

	/**
	 * PUT /api/waf/tuning
	 *
	 * Replace the exclusions list and/or the paranoia level, then reload
	 */
	.put(async (req, res, next) => {
		try {
			const payload = await apiValidator(getValidationSchema("/waf/tuning", "put"), req.body);
			const data = await internalWaf.updateTuning(res.locals.access, payload);
			res.status(200).send(data);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

export default router;
