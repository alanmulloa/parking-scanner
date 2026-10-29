# Continuation audit — 2026-10-29

This note reconstructs the repository state after the Codex session was interrupted by quota exhaustion.

## Confirmed completed before interruption

The fresh reconciliation **did execute successfully**. Evidence is `tools/sheet-import/reports/final-validation-fresh-20261029.json`:

- source SHA-256: `600d2a8f218a4c8392cc130fbbb6eb10dec274bdaeb0a7dca190d148708845c5`
- users: 77 / 77
- dwellings: 77 / 77
- vehicles: 35 / 35
- audit: 1173 / 1173
- differences: 0
- slots/QR/legacy IDs/relations: 0 conflicts
- identity alias for the changed email was applied
- the three missing audit rows were imported

The included workbook `tools/sheet-import/DDBB_QR_Comunidad_TEST.xlsx` is older (`a365ec...`) and must not be treated as the final 29/10 snapshot.

## New backend work present in the repository

The interrupted session created at least these additional pieces beyond the previously documented migration 119:

- migration 120: final application backend (bootstrap, scanner/control RPCs, request/incident resolution, dashboard, ROOT status, audit/RLS work)
- migration 121: stable-parity corrections
- migration 122: session revocation enforcement
- Edge Function `parking-admin`
- frontend `supabase-final-adapter.js`

Remote application of migrations 120–122 is **not proven by the ZIP alone** and must be checked against the linked Supabase project before deployment.

## Critical wiring finding

`supabase-final-adapter.js` existed but no HTML entry point loaded it. `supabase-poc.html` still loaded only the old POC adapter.

A new `preproduccion.html` has therefore been added that loads, in order:

1. stable application bundle
2. POC Supabase adapter (vehicles/slots/QR/temporaries)
3. final Supabase adapter (JIT/bootstrap/control/incidents/requests/audit/ROOT)
4. app initializer

Production `index.html` was intentionally not changed.

## Administrative actions wired in this continuation

The final adapter now maps these existing UI actions to the already-present `parking-admin` Edge Function:

- `saveUser`
- `adminSetPassword`
- `adminGeneratePassword`
- `closeUserSessions`

`parking-admin` was also corrected so ROOT can resolve the active community even though ROOT deliberately has no normal `community_members` row.

## Action coverage

The stable UI contains 49 backend action names.

After the continuation changes, 43 are covered by the Supabase adapter stack. The remaining known items are:

- `ownerImportTemplate`
- `previewOwnerImport`
- `applyOwnerImport`
- `consistencyReport`
- `consistencyFix`
- `uploadLogo`

These are administrative conveniences, not the core access/control flow. They still need deliberate Supabase implementations before claiming full parity.

A reproducible static check is available at:

`tools/preprod-tests/adapter-action-coverage.mjs`

## Diagnostics

The final adapter now calls `root_system_diagnostics()` when available instead of returning a completely synthetic diagnostics response. Google Sheets benchmark calls are explicitly marked not applicable in Supabase preproduction.

## Still required before opening preproduction

1. Verify remote migration list includes 120, 121 and 122.
2. Deploy/verify `parking-admin` after the ROOT-community correction.
3. Verify `legacy-auth-migrate` is still deployed and its allowed origin includes the preproduction origin.
4. Publish the repository to a staging URL and open `preproduccion.html`.
5. Execute real UI tests for ROOT, ADMIN, CONTROL and PROPIETARIO.
6. Complete or consciously defer the six administrative actions listed above.
7. Do not change production Apps Script, TinyURL or historical QR routing during this phase.

## Static/regression checks executed in this continuation

- JavaScript syntax check for all current adapters/modules: OK.
- Stable FIX11.29 auto-slot/admin-password suite: OK.
- Stable ROOT system-access suite: OK.
- Stable ADMIN/ROOT configuration split suite: OK.
- Stable plate uniqueness/consolidation suite: OK.
- Stable incident flow FIX5 suite: OK.
- Historical owner-import test reports one version-label assertion (`Frontend FIX11.6`) against the later FIX11.29 bundle; its functional owner-import assertions continue to pass. This is a historical test-version mismatch, not evidence that the current Supabase owner-import actions are implemented.
