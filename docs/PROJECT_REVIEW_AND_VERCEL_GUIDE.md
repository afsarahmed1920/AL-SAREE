# AL-SAREE: project review and Vercel guide

This is an internal inventory app for store staff. The frontend is a React 19 + Vite SPA, with Supabase providing authentication, database, storage, and Edge Function services. Vercel hosts the static frontend only; it does not deploy the Supabase backend. The connected Supabase project `al-saree` was inspected and its database policies and Edge Function deployment were updated as described below.

## Review findings

### Addressed in this change

| Priority | Finding | Change |
| --- | --- | --- |
| P2 | Dashboard, product list, and scanner were imported into the initial route bundle even when the user opened another page. | Those three screens now load on demand. A skeleton is shown while a route chunk loads. Barcode scanner and spreadsheet libraries remain feature-level dynamic imports. |
| P2 | The WebAuthn browser library was imported with the login screen, including for users who never use passkeys. | The browser-support check is lightweight; WebAuthn code now loads only when passkey registration or sign-in is selected. |
| P1 | A username stored in `sessionStorage` was treated as sufficient to open the workspace, even when Supabase had no active session. | The workspace now waits for Supabase session restoration and derives the UI user from the authenticated session. |
| P2 | The service worker used a fixed cache version and cached every same-origin GET indefinitely. | Cache is now limited to the app shell, icons, manifest, and hashed Vite assets. Navigation is network-first with the cached shell as the offline fallback. Updates wait for open app tabs to close before activating, then remove old AL-SAREE shell caches. |
| P2 | Supabase project values were read from a generated source file, making deployment-specific configuration hard to manage. | The app now reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; a visible setup message is shown when either is missing. The generated Figma file remains untouched. |
| P2 | Vercel did not have explicit SPA fallback or deployment/cache settings in the repository. | `vercel.json` sets the frozen pnpm install, Vite build, `dist` output, SPA rewrite, and cache headers for immutable hashed assets and revalidated PWA metadata. |
| P1 | Offline catalog data and queued edits could be reused across accounts on a shared device. | Catalog caches are now keyed by Supabase user ID; the old unscoped catalog store is discarded on upgrade. Queued edits retain their owner's ID and only that authenticated account can view or sync them. Offline product context is also stored per user. |
| P2 | Product editing loaded full catalogs for every branch and every save refreshed every branch. | Editing reuses cached branch catalogs and fetches only branches with no cache. Saving no longer refreshes all branches; the active Products screen refreshes its branch once, while another branch refreshes when opened. |
| P1 | The live Supabase project had no Edge Functions, so the frontend's admin and passkey routes returned no route. | Deployed `make-server-8a5f868b` v1. Admin actions validate the bearer token with Supabase Auth and require an active `master` profile. Passkey registration requires an authenticated active user; login verifies a one-use, five-minute challenge, credential, RP ID, origin, user verification, active profile, and counter before generating a Supabase magic-link token. The function is configured with platform JWT verification off because passkey discovery/login is public; protected handlers perform their own user validation. The service-role key stays in the Edge Function environment. |
| P1 | The live policies and privileged RPCs needed a project-level check; one security-definer RPC used the caller's mutable `search_path`, and price-edit permission was not constrained to also allow viewing. | The migrations fix the catalog RPC search path, require edit permission to imply view permission at the table and RPC layers, revoke direct client access to branch inventory and passkey records, and split write policies by SQL command. Direct `branch_products` and passkey-table access remains intentionally denied; guarded RPCs and the service role provide the required operations. |
| P2 | Supabase's advisor found unindexed foreign keys and policies that repeated identity checks per row. | Added indexes for the reported foreign keys and common product/audit lookups, hoisted auth checks in policies, and removed overlapping permissive read policies. The post-change performance advisor no longer reports unindexed foreign keys or multiple permissive policies. New indexes show as unused until the small live dataset exercises those paths. |

### Remaining risks and review limits

| Priority | Finding | Required follow-up |
| --- | --- | --- |
| P1 | The connected project had no migration history before these changes; its original tables, policies, and RPCs were created outside this repo. | The two new incremental migrations are checked in under `supabase/migrations/` and match the live project migration history. This repo still lacks the original bootstrap schema migration, so a fresh Supabase project cannot be rebuilt from these incremental files alone. Capture and review a baseline schema before setting up another environment. |
| P1 | Role-level authorization has been inspected, but end-to-end role tests were not run with staff, branch manager, and master accounts. | Before production sign-off, verify direct table access, `get_branch_catalog_secure`, `upsert_branch_product`, user management, and Storage behavior with test accounts for each role. A successful Edge Function deployment does not replace those checks. |
| P1 | The passkey app settings currently have a blank RP ID and origin even though `passkey_enabled` is true. | Passkey endpoints fail closed with a setup error until `passkey_rp_id` and `passkey_origin` match the final HTTPS app domain. Set these after the production Vercel domain is chosen; passkeys on Preview domains require configuring that exact origin. |
| P2 | Supabase Auth has leaked-password protection disabled. | Enable leaked-password protection in Supabase Auth password security settings. It is an Auth dashboard setting and is not changed by the SQL migrations. |
| P1 | Browser storage remains local to the device and is not an authorization boundary. A user can inspect or alter their own cached data through browser developer tools. | Keep RLS and RPC authorization authoritative. Consider an app lock/device policy for shared terminals and test offline sign-out/account-switch behavior on the target browsers. |
| P2 | Several security-advisor notices remain by design: `branch_products`, `user_passkeys`, and `passkey_challenges` have RLS enabled with no client policy; callers cannot access those tables directly and the app uses guarded RPCs or service-role server code. Helper and business RPCs remain executable by `authenticated` because policies/app operations call them, and they contain explicit account/branch checks. | Review these advisories if the access design changes. Do not add broad client policies merely to make the advisor notice disappear. |
| P2 | Several client operations depend on Supabase project configuration and remote function behavior. A successful Vercel static build does not prove Supabase auth, RLS, Storage, or Edge Functions are healthy. | Run the preview checks below against the intended Supabase project and confirm its auth redirect allow-list and function deployments. |

The Supabase anon/publishable key is expected to be visible in a browser app. It is safe only when the database, Storage, and functions enforce permissions. Never put a Supabase service-role key in a `VITE_` variable or browser bundle.
The `make-server-8a5f868b` Edge Function uses Supabase's server-side `SUPABASE_SERVICE_ROLE_KEY`; keep it in the Supabase Edge Function environment only. It is not a Vercel frontend variable.

The repository currently has a legacy `anon` key in its generated Figma configuration. Supabase describes this as a public client key that must be paired with RLS, and plans to deprecate legacy `anon` keys by the end of 2026; use the project's public key for the frontend and plan the migration to a publishable key before then. See [Supabase API key guidance](https://supabase.com/docs/guides/getting-started/api-keys).

## Local setup

1. Use the repository-pinned Node 22 and pnpm 10.34.3 toolchain from `.mise.toml` and `package.json`.
2. Copy `.env.example` to `.env.local` and set values from **Supabase → Project Settings → API**:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-public-anon-key
   ```

3. Install locked dependencies and build:

   ```sh
   pnpm install --frozen-lockfile
   pnpm build
   ```

The build should create `dist/`. Build-time Vite variables are embedded in the frontend, so set them in the environment before each build. See [Vite environment variables](https://vite.dev/guide/env-and-mode).

## Deploy to Vercel

1. Push this repository, including `pnpm-lock.yaml` and `vercel.json`, to the Git provider connected to Vercel.
2. Import the repository in Vercel. Set the Root Directory to the repository root and Node.js to 22. `package.json` pins pnpm 10.34.3; the checked-in `vercel.json` selects frozen pnpm install, `pnpm build`, and `dist` output. Confirm the project settings show the same values.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to **Preview** and **Production** environments. Add **Development** too if using Vercel CLI locally. Redeploy after changing a variable because Vite consumes it at build time.
4. In Supabase Auth URL settings, set the production app URL as the Site URL and add the production URL, the Vercel preview URL pattern you actually use, and local development URL to Redirect URLs. Confirm passkey/WebAuthn origins and RP ID are configured for the production hostname in the deployed function.
5. Deploy a Preview from a non-production branch first. Test login and the checks below. Merge or promote only after the Supabase backend checks pass; Vercel deployment does not deploy Supabase migrations or functions.

Vercel's official [Vite guide](https://vercel.com/docs/frameworks/frontend/vite) documents the SPA rewrite requirement; [project configuration](https://vercel.com/docs/project-configuration/vercel-json) documents `vercel.json` build and routing settings. Hashed Vite assets receive long-lived immutable caching; `/sw.js` and the manifest must revalidate so updates are discovered. The root HTML uses Vercel's default `max-age=0, must-revalidate` behavior.

## Preview and release checklist

- Build completes with the pinned toolchain and the intended Preview/Production variables.
- Open `/`, then refresh directly at `/products`, `/scan`, `/count`, `/history`, `/backup`, and `/settings`; each route should return the SPA and load its own screen.
- Verify a missing Supabase variable shows the setup message instead of an app crash. Verify login, logout, and session restoration with a test account.
- Verify the deployed `make-server-8a5f868b/health` route. With a master test account, create a user, change its active status, and reset its password; confirm non-master accounts receive 403 responses and unauthenticated admin calls receive 401 responses.
- After setting passkey RP ID/origin to the production domain, register a passkey, sign out, sign in with it, and confirm replaying an assertion or using it for a disabled account fails.
- Test camera permission and barcode scan on HTTPS; verify manual and hardware scanner input as well.
- With a catalog already synced, go offline, reload, search/scan, queue an allowed edit, reconnect, and confirm queue sync and refreshed catalog.
- On a shared test device, sign out and sign in as a different test account; confirm the previous account's cached catalog, cached product context, and pending queue are not visible or synced in the new account. Re-enter the original account and confirm its pending edit remains available.
- Install or update the PWA after a new deployment; confirm it loads the current build online and the cached shell offline. Bump the cache suffix in `public/sw.js` when changing shell/cache semantics.
- Check the browser Network panel: initial route should not fetch the backup, settings, history, users, stock-count, scanner, WebAuthn, or spreadsheet chunks until those screens/features are opened. Record initial JavaScript transfer size for future comparisons.
- Confirm `robots` remains `noindex` for this internal inventory app. If the product is intentionally made public later, update the robots meta tag in `index.html` before launch.
- Verify RLS, Storage policy, RPC permissions, and deployed admin/passkey routes with accounts of each role. A successful frontend preview alone is not a security sign-off.
