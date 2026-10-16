# Plan: branch availability on product form + mobile login polish

## Context
Root cause of issue 2: `newDraft()` in `src/lib/products.ts` creates every branch with `available = true`, so saving a new product with prices on one tab also creates an available-but-price-less row for the other branch. The data model already supports per-branch prices (`branch_products`, one row per branch) and hiding (`get_branch_catalog_secure` returns only `is_available` rows), so no SQL change is needed.

## Part A — Availability selector (requests 1, 2, 3)
`src/components/ProductForm.tsx` (branch section, ~line 266) and `src/lib/products.ts`:
1. Replace the per-tab "Available here" toggle with a top "Where is this product sold?" segmented control built from `branches`: one chip per branch plus "All branches" (checkbox-style chips so any combination works; with 2 branches = Jeddah / Makkah / Both).
2. New product default: only the currently selected branch is available (pass the active branch code from `Products` into `newDraft(branches, activeBranchId)`), others `emptyBranch(false)`. Edit mode keeps loaded availability.
3. Price tabs: show a tab only for available branches; each tab has its own purchase/wholesale/retail/stock/branch-code fields (already independent, so prices can differ per branch). Add a small "Copy prices from {other branch}" button as a starting point, then edit freely.
4. Validation on save: at least one branch selected (new string `selectBranch`); warn (not block) if an available branch has no retail price.
5. `saveDraft`: unchanged logic works, since unchecked + never-available branches are skipped and unchecking an existing branch calls `upsert_branch_product(p_is_available=false)`, which removes it from that branch's catalog. Make sure toggling availability sets `touched: true` (already via `patchBranch`). Keep cache re-sync for all branches.
6. Product list/Scanner/Dashboard need no change (already filtered by RPC). Changing branch availability of an existing product is done by the same selector in edit mode.
7. i18n keys: `soldIn`, `allBranches` (exists), `copyPricesFrom`, `selectBranch`, `noRetailWarn` in `src/lib/app-context.tsx`.

## Part B — Mobile login polish (request 4)
`src/components/Login.tsx` (currently the dark brand panel is `hidden lg:flex`, so mobile gets a plain form):
1. Mobile: compact dark hero header (brand navy with the logo, company name, one-line tagline and the accent bar), then a rounded-t-3xl card sliding over it containing the form; footer content (phones, addresses, privacy/terms) collapses under the form as tap-to-call chips.
2. Form: 48px+ fields, show/hide password eye toggle, username `autoCapitalize="none"`, `enterKeyHint`, full-width 52px sign-in button, safe-area bottom padding, `min-h-dvh`; language/theme toggles on the hero's top corner.
3. Security fix found while reading: `submit()` contains a hardcoded fallback `username === "master" && p === "master123"` that logs the UI in without Supabase. Remove it.
4. Reuse `Logo`, `useCompanyName`, `useSettings` (already used there).

## Verification
`pnpm exec tsc --noEmit -p .`, `pnpm build`. Manual on a phone-width viewport: add a product for Jeddah only, then confirm it does not appear in Makkah (Products and Scanner); add a product for both with different retail prices, confirm each branch shows its own price; untick a branch in edit mode and confirm it disappears there; login page at 375px width.
