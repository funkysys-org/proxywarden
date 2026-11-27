import express from "express";

/**
 * GET /docs — Swagger UI for the live OpenAPI 3.1 schema (GET /schema).
 *
 * The schema itself stays the single source of truth and is served live
 * by ./schema.js (version + server URL injected per request). This route
 * only serves the HTML shell; the UI bundle is loaded from unpkg, pinned
 * to an exact swagger-ui-dist release.
 */

const UI_VERSION = "5.35.0"; // swagger-ui-dist (pinned; bump = this one line)

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>API Docs</title>
	<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@${UI_VERSION}/swagger-ui.css" />
	<style>
		body { margin: 0; }
		#bar { background: #14b8a6; color: #fff; font: 14px/1.4 system-ui, sans-serif; padding: 10px 16px; }
		#bar b { font-weight: 600; }
	</style>
</head>
<body>
	<div id="bar">API reference &mdash; rendered live from <b>GET /api/schema</b> (OpenAPI 3.1)</div>
	<div id="swagger-ui"></div>
	<script src="https://unpkg.com/swagger-ui-dist@${UI_VERSION}/swagger-ui-bundle.js" crossorigin></script>
	<script>
		window.addEventListener("load", function () {
			window.ui = SwaggerUIBundle({
				url: "/api/schema",
				dom_id: "#swagger-ui",
				deepLinking: true,
				persistAuthorization: true,
				tryItOutEnabled: true
			});
		});
	</script>
</body>
</html>`;

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

router
	.route("/")
	.options((_, res) => {
		res.sendStatus(204);
	})

	/**
	 * GET /docs
	 */
	.get((_, res) => {
		res.status(200).type("html").send(PAGE);
	});

export default router;
