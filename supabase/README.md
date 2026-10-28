# Parking Comunidad - Supabase Migración V1

Proyecto remoto:
- Project ref: `tefnzjvylcvffnorgzls`
- Project URL: `https://tefnzjvylcvffnorgzls.supabase.co`

Esta fase NO conecta el frontend productivo a Supabase. Apps Script + Sheets siguen siendo producción.

## Qué crea

- communities
- profiles (ligado a `auth.users`)
- community_members
- dwellings
- vehicles
- temporary_periods
- requests
- incidents
- incident_followups
- qr_controls
- plate_controls
- audit_log
- community_settings

## Reglas protegidas por PostgreSQL

- matrícula habitual única por comunidad, normalizada (`6862 NGW`, `6862-NGW`, `6862ngw` = misma matrícula)
- un único Slot 1 y Slot 2 por vivienda
- QR único por comunidad
- FKs reales entre vivienda, vehículo, incidencias y solicitudes
- RLS activo en todas las tablas públicas
- ROOT separado de los roles de comunidad

## Importante

1. No migrar `PasswordHash` ni `PasswordSalt` de Sheets.
2. Los usuarios se crearán de nuevo en Supabase Auth durante la fase de migración de identidades.
3. `legacy_id` conserva los IDs actuales (`USR_`, `VIV_`, `VEH_`, etc.) para trazabilidad.
4. No incluir nunca `service_role` o secret keys en el repositorio/front.
5. Desde el momento en que se aplican estas migraciones, cualquier cambio de esquema debe hacerse con una migración nueva; no modificar tablas manualmente desde el Dashboard.

## Aplicación con CLI (opción manual)

```bash
supabase login
supabase link --project-ref tefnzjvylcvffnorgzls
supabase db push --dry-run
supabase db push
```

Si ya vinculaste GitHub/Supabase para aplicar `supabase/migrations`, alcanza con publicar esta carpeta en la raíz de `parking-scanner` y revisar el job de integración antes de seguir.
