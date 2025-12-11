## Overview

* Establish a secure Supabase client for the Vite React app and an optional server-side client for privileged operations.

* Use environment variables so keys are never hard-coded or committed.

* Add a lightweight connectivity check with robust error handling.

## Dependencies

* Install: `npm install @supabase/supabase-js`

* Confirm existing tooling: `vite`, TypeScript, and ESLint are already present.

## Environment Configuration

* Client (Vite): create `.env.local` with:

  * `VITE_SUPABASE_URL=<your-project-url>`

  * `VITE_SUPABASE_ANON_KEY=<your-anon-key>`

* Server (Express, optional for privileged ops): add `.env` with:

  * `SUPABASE_URL=<your-project-url>`

  * `SUPABASE_SERVICE_ROLE_KEY=<service-role-key>`

* Do not commit `.env*` files; they are already gitignored.

## Client Setup

* Add `src/vite-env.d.ts` with `/// <reference types="vite/client" />` to type `import.meta.env`.

* Create `src/lib/supabase.ts`:

```ts
import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const supabase = url && anon ? createClient(url, anon) : undefined;
```

* Usage example (any component or `src/main.tsx`):

```ts
if (supabase) {
  const { data, error } = await supabase.from("test_table").select("*").limit(1);
}
```

## Server Setup (Optional, for privileged operations)

* Create `server/lib/supabase.ts`:

```ts
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!; // never expose client-side
export const supabaseAdmin = createClient(url, key);
```

* Use `supabaseAdmin` in server routes for inserts/updates that require bypassing RLS or for secure tasks. Keep service role key only on the server.

## Connectivity Check & Error Handling

* Add a startup probe (client):

```ts
try {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.from("test_table").select("*").limit(1);
  if (error) throw error;
  console.info("Successfully connected to Supabase", { sample: data });
} catch (err) {
  console.error("Connection error:", (err as Error).message);
}
```

* Optionally wrap in a custom hook or a diagnostics panel if desired.

## Security Best Practices

* Enable RLS on all tables; add policies for specific read/write needs.

* Only use the anon key in the browser; never ship the service role key to the client.

* Store keys in environment variables; do not hard-code.

* For server-to-server or REST calls outside the SDK, use `Authorization: Bearer <SERVICE_ROLE_KEY>`; client SDK automatically attaches anon key.

## Authentication Headers

* Client: `@supabase/supabase-js` handles auth headers using the anon key internally.

* Server: when using the SDK, headers are handled. For direct REST calls, set `Authorization: Bearer <SERVICE_ROLE_KEY>` and `apikey: <SERVICE_ROLE_KEY>`.

## Verification

* Run: `npm run typecheck` and `npm run lint`.

* Start dev: `npm run dev` (Vite) and `npm run server:dev` (Express) if server is used.

* Open the app; check console for "Successfully connected to Supabase". If errors, confirm env values and network connectivity.

## Optional Next Steps

* Migrate app data (e.g., students, assessments) to Supabase Postgres and replace MySQL in server services.

* Add Supabase Auth for admin features; protect routes with JWT verification.

* Implement UI read/write flows with `supabase.from("students")` and secure server-side

