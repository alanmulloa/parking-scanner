# Parking Comunidad

La migración Sheet → Supabase está documentada en:

- `docs/SHEET_DATA_PROFILE.md`
- `docs/SUPABASE_DATA_MODEL.md`
- `docs/AUTH_JIT_MIGRATION.md`
- `docs/IMPORT_RUNBOOK.md`
- `docs/RECONCILIATION_REPORT.md`
- `docs/FINAL_MIGRATION_VALIDATION.md`
- `MIGRATION_STATUS.md`

El importador reproducible está en `tools/sheet-import`. Su modo predeterminado es dry-run; `APPLY` exige credenciales de servidor y confirmación explícita del checksum del XLSX.

La migración de datos y el backend JIT están validados en staging. La aplicación todavía no tiene paridad funcional; no realizar un corte productivo hasta cerrar los bloqueos descritos en `MIGRATION_STATUS.md`.
