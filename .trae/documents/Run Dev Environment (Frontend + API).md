## Overview

* The dev script runs the Vite React app [package.json:scripts.dev](file:///d:/e-sba-io/package.json#L6-L23) on port 5174, with proxy to the API at <http://localhost:3001> configured in [vite.config.ts](file:///d:/e-sba-io/vite.config.ts#L10-L27).

* The API server listens on port 3001 as defined in [server/index.ts](file:///d:/e-sba-io/server/index.ts#L732-L756).

## Pre-Flight

* Ensure .env contains required values (DATABASE\_URL/POSTGRES\_URL/NEON\_DATABASE\_URL, JWT\_SECRET for dev, optional CSRF\_SECURE=false for HTTP).

* Close any apps using ports 5174 or 3001 to prevent conflicts.

## Commands to Run

* Start API server in Terminal A:

  * npm run server:dev

* Start frontend

