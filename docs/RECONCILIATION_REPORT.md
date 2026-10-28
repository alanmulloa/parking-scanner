# Reconciliación Sheet → Supabase

El reporte definitivo está en `FINAL_MIGRATION_VALIDATION.md`. La reconciliación persistida se generó automáticamente en `tools/sheet-import/reports/final-validation.json`.

| Entidad | Sheet | Supabase | Diferencia |
|---|---:|---:|---:|
| Usuarios | 77 | 77 | 0 |
| Viviendas | 77 | 77 | 0 |
| Vehículos | 35 | 35 | 0 |
| Auditoría | 1.170 | 1.170 | 0 |

Duplicados de email, matrícula, QR, slot e IDs legacy: 0. Relaciones rotas o cross-community: 0. Las 23 auditorías sin entidad actual conservan su `legacy_entity_id` y no constituyen pérdida de información.

Datos y RLS: OK. JIT sintético: OK. Primer y segundo login con la cuenta TEST y una credencial legacy real: OK. Hash/salt retenidos; ninguna purga ejecutada.
