## Architecture Overview
- Backend: Express server with route modules for auth, assessments, students, reporting, attendance, sync. Central error handlers and health checks in [index.ts](file:///d:/e-sba-io/server/index.ts).
- Middleware: JWT verification and role checks in [auth middleware](file:///d:/e-sba-io/server/middleware/auth.ts).
- Database: Neon Postgres via node-pg Pool with SSL and timeouts in [db.ts](file:///d:/e-sba-io/server/lib/db.ts).
- Frontend: React app using an API client with retry and dev fallback in [apiClient.ts](file:///d:/e-sba-io/src/lib/apiClient.ts). ErrorBoundary for UI failures in [ErrorBoundary.tsx](file:///d:/e-sba-io/src/components/ErrorBoundary.tsx).
- Build/Runtime: Vite dev proxy to backend [vite.config.ts](file:///d:/e-sba-io/vite.config.ts), Vercel routing [vercel.json](file:///d:/e-sba-io/vercel.json), tests in [server/tests](file:///d:/e-sba-io/server/tests) and [src/tests](file:///d:/e-sba-io/src/tests).

## Findings & Risks
- Auth: CSRF cookie can be blocked in multi-domain setups; JWT secrets missing in production degrade security. See [auth routes](file:///d:/e-sba-io/server/routes/auth.ts), [auth middleware](file:///d:/e-sba-io/server/middleware/auth.ts).
- DB: Neon connectivity depends on pooled endpoints with sslmode=require; transient connection timeouts must be handled. See [db.ts](file:///d:/e-sba-io/server/lib/db.ts).
- API client: Retries exist but lack exponential backoff/jitter and explicit typed errors. See [apiClient.ts](file:///d:/e-sba-io/src/lib/apiClient.ts).
- UI: ErrorBoundary exists but lacks chunk-load detection UI flows. See [ErrorBoundary.tsx](file:///d:/e-sba-io/src/components/ErrorBoundary.tsx).

## Industry Patterns (Research)
- Neon: Use pooled endpoints and handle connection/transient errors; retry or degrade gracefully [Neon connection pooling](https://neon.com/docs/connect/connection-pooling), [Neon connection errors](https://neon.com/docs/connect/connection-errors), [Choosing driver & pooling](https://neon.com/docs/connect/choose-connection).
- Resilience: Exponential backoff, jitter, circuit breaker; see Cockatiel library [cockatiel](https://www.npmjs.com/package/cockatiel), examples on StackOverflow [circuit breaker & retry](https://stackoverflow.com/questions/78806348/how-to-implement-circuit-breaker-and-retry-policy-in-an-express-app) and articles [backoff guide](https://medium.com/@devharshgupta.com/building-resilient-systems-with-api-retry-mechanisms-in-node-js-a-guide-to-handling-failure-d6d9021b172a), [advanced retry](https://v-checha.medium.com/advanced-node-js-patterns-implementing-robust-retry-logic-656cf70f8ee9).
- React ErrorBoundary & chunk load handling: [React docs](https://legacy.reactjs.org/docs/error-boundaries.html), community guidance on chunk failures [1](https://stackoverflow.com/questions/68663106/how-to-solve-chunk-load-error-in-create-react-app-project), [2](https://stackoverflow.com/questions/44601121/code-splitting-causes-chunks-to-fail-to-load-after-new-deployment-for-spa), [3](https://stackoverflow.com/questions/69047420/webpack-code-splitting-chunkloaderror-loading-chunk-x-failed-but-the-chunk-e).

## Error Scenarios & Requirements
- DB connection failures: Detect pool.connect errors/timeouts; return 503 with non-leaky messages; log with correlation IDs.
- API timeouts: Wrap external calls (e.g., blob uploads) with retry/backoff and circuit breakers; time out and fallback.
- Auth errors: Clear messages for CSRF mismatch, invalid credentials, expired/invalid JWT; audit logging for login attempts.
- Validation failures: 400 with concise details; avoid stack traces.
- Network/Offline: Client detects offline; show retry CTA; API client backs off.
- Chunk/Version skew: Detect chunk load failure; show refresh guidance; auto-reload with guard.
- Memory leaks: Ensure client.release() in DB; avoid unbounded listeners; cap retries.
- Security: Never leak secrets; normalize error responses; enforce JWT env presence.

## Implementation Guide (Phased)
### Central Error Types & Handling
- Define custom error classes: AppError (status, code), ValidationError (400), AuthError (401/403), ServiceUnavailableError (503), DbError (500/503).
- Update global error middleware in [index.ts](file:///d:/e-sba-io/server/index.ts#L87-L106, file:///d:/e-sba-io/server/index.ts#L536-L556) to map errors → status/json consistently and attach request IDs.

### Logging & Monitoring
- Introduce structured logger (winston/pino) with request ID middleware.
- Integrate Sentry/OpenTelemetry for error traces in production.
- Log DB health status changes; alert on consecutive failures.

### DB Resilience (Neon)
- Require pooled DATABASE_URL with sslmode=require; validate at boot; expose [DB health](file:///d:/e-sba-io/server/index.ts#L109-L119).
- Wrap pool.connect with bounded timeout; report 503 on failures; release clients on error.
- Avoid retrying transactional queries; only retry connect/transient reads with backoff.

### External Services Resilience
- For '@vercel/blob' and similar: use Cockatiel policies (retry with exponential backoff + circuit breaker) around network calls.
- Provide fallbacks (e.g., write to temp file or queue) when upstream is down.

### Authentication Flow Hardening
- Enforce JWT env presence in production; return 503 if misconfigured.
- CSRF cookie attributes configurable via env for multi-domain setups.
- Rate-limit login attempts; add basic audit logs.

### Client Error Handling
- Enhance apiClient: exponential backoff + jitter; distinguish typed errors (Auth, Validation, Network, Timeout) and map to UX.
- Offline detection; show friendly UI with retry and status. Keep chunk failure auto-reload guard.
- Wrap major routes/components with ErrorBoundary for granular recovery.

### Security Controls
- Sanitize all error messages; no stack/SQL details in responses.
- Ensure secrets never logged; redact sensitive headers.
- Validate inputs at boundary with schema (zod/yup) while keeping current architecture style.

### Testing & Automation
- Unit tests: custom errors, mappers, auth error paths, CSRF, JWT invalid/expired.
- Integration tests: DB health degrading, login rate-limits, blob upload retries.
- E2E: Offline scenarios, chunk failure UI, invalid credentials flows.
- CI: Include Postgres service; wire Neon secrets; fail fast on missing env.

## Code Examples (Illustrative)
- Express error classes/middleware integration; Cockatiel policy wrapping external calls; apiClient retry with exponential backoff & jitter; React ErrorBoundary refresh guard.

## Monitoring & Alerting
- Sentry project with environment tags; alerts for auth 5xx spikes and DB health failures.
- OpenTelemetry traces for /api/auth/login, DB connect spans.

## Maintenance & Documentation
- Error handling playbook: update monthly; review incident postmortems; rotate JWT secrets policy.
- Documentation: inline docstrings for error types/middleware, runbook for on-call.

## Next Steps (Request for Confirmation)
1. Implement central error classes and unify error middleware.
2. Add structured logging and optional Sentry/OpenTelemetry.
3. Harden DB connect handling and health boot validation.
4. Wrap external services with Cockatiel policies.
5. Expand apiClient with backoff/jitter and typed errors.
6. Extend tests to cover error scenarios and CI health.

Confirm this plan and I will proceed to implement changes incrementally, ensuring no disruptions to the existing login UI and behavior while strengthening resiliency and observability.