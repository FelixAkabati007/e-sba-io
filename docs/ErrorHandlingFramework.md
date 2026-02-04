# Error Handling Framework

This document outlines the comprehensive error handling strategy for the E-SBA application, covering backend services, database interactions, and frontend user experience.

## 1. Backend Error Handling (Node.js/Express)

### 1.1 Global Error Handler

All uncaught exceptions and rejected promises must be routed to a centralized global error handler.

- **Middleware**: Use a final error-handling middleware `(err, req, res, next)`.
- **Async Errors**: Use `express-async-errors` or wrap async route handlers to ensure errors propagate to the middleware.
- **Response Format**: Standardize error responses.
  ```json
  {
    "error": "User-facing error message",
    "code": "ERROR_CODE",
    "details": "Optional debug info (dev only)"
  }
  ```

### 1.2 Database Resilience (Neon/Postgres)

Neon serverless connections can be transient. Implement robust retry logic.

- **Connection Retry**: Use exponential backoff for initial connection attempts.
- **Query Retry**: Retry transient errors (e.g., `57P01`, `08006`, connection timeouts) for idempotent operations.
- **Pool Configuration**: Ensure `ssl: { rejectUnauthorized: false }` for Neon, set `connectionTimeoutMillis` and `idleTimeoutMillis` appropriately.

### 1.3 External Service Integration

- **Circuit Breaker**: For non-critical external APIs, fail fast if the service is down to prevent cascading failures.
- **Timeouts**: Set strict timeouts on all external requests.

## 2. Frontend Error Handling (React)

### 2.1 Error Boundaries

Protect the UI from crashing completely due to component errors.

- **Global Boundary**: Wrap the entire app to catch unhandled errors and show a "Something went wrong" page with a reload option.
- **Granular Boundaries**: Wrap complex widgets (e.g., Grids, Charts) to isolate failures.
- **Chunk Load Errors**: Handle `Loading chunk X failed` by automatically reloading the page (with loop protection).

### 2.2 API Client Resilience

- **Retry Logic**: Automatically retry network failures (5xx, network errors) with exponential backoff.
- **User Feedback**: Display toast notifications for transient errors; use specific error messages for 400-series validation errors.
- **Offline Mode**: Detect offline state and queue critical mutations or warn the user.

## 3. Monitoring and Logging

### 3.1 Centralized Logging

- **Format**: Use structured JSON logging (e.g., `winston` or `pino`).
- **Levels**:
  - `ERROR`: System is in distress, requires attention.
  - `WARN`: Unexpected event, but system is functioning.
  - `INFO`: Normal operational events.
- **Context**: Include request ID, user ID, and stack traces in logs.

### 3.2 Alerting

- Monitor `5xx` error rates and DB connection failure spikes.
- Alert on `Uncaught Exception` or `Unhandled Rejection` events.

## 4. Implementation Checklist

- [ ] **Backend**: Implement `retrying-query` wrapper for `pg` pool.
- [ ] **Backend**: Verify Global Error Handler catches all async errors.
- [ ] **Frontend**: Enhance `apiClient.ts` with configurable retry logic.
- [ ] **Frontend**: Update `ErrorBoundary.tsx` to handle chunk loading failures specifically.
- [ ] **Ops**: Configure log aggregation (e.g., Vercel Logs, Datadog).
