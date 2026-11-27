import express from "express";
import internalMetrics from "../internal/metrics.js";
import internalReport from "../internal/report.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import { debug, express as logger } from "../logger.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

router
	.route("/hosts")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * GET /reports/hosts
	 */
	.get(async (req, res, next) => {
		try {
			const data = await internalReport.getHostsReport(res.locals.access);
			res.status(200).send(data);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

router
	.route("/metrics")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * GET /reports/metrics
	 *
	 * vts per-host traffic stats, scoped by the caller's host visibility
	 */
	.get(async (req, res, next) => {
		try {
			const data = await internalMetrics.getMetricsReport(res.locals.access);
			res.status(200).send(data);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

export default router;
