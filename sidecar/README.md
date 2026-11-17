# WAF sidecar — F4 placeholder (design sketch, not yet implemented)

The audit-log viewer needs an HTTP endpoint the frontend can call. The NPM
backend is UNTOUCHED (product invariant), so a small sidecar service provides
it.

## Design (to validate in the F4 spike)

- Runs inside the same container (s6 service, like the modsec-seed oneshot)
  or as a companion process; reads the ModSecurity audit log at
  `/data/logs/modsec_audit.log` (JSON lines, `SecAuditLogFormat JSON`).
- Auth: verifies the SAME JWT the NPM API issues (`JWT_SECRET` env is shared
  by backend and sidecar), stateless signature check; additionally gates on
  the admin role — non-admin users get 403 and the UI entry stays hidden.
- Endpoints (provisional):
  - `GET /audit?host=<id>&since=<ts>&limit=<n>` — parsed audit entries
  - `GET /status` — engine mode + rule set version (CRS ver)
- Serving path (open question for the spike): the UI is served by the
  backend at `/app/frontend`; the sidecar must be same-origin to inherit the
  Authorization header — candidates: (a) a custom nginx location wired into
  the :81 server, (b) backend static-proxy trick, (c) dedicated port with
  CORS. Decision documented here once spiked.

Nothing in `build/Dockerfile` references this directory yet; F4 will wire it.
