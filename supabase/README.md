# Parking Comunidad - Supabase staging

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

## Identidades y contraseñas

1. Los 77 usuarios importados ya existen en Supabase Auth y conservan `legacy_id` para trazabilidad.
2. Hash y salt legacy se almacenan temporalmente en `private.legacy_auth_credentials`, sin permisos para `anon` ni `authenticated`, solo para la migración JIT.
3. No purgar hash/salt hasta que la política futura de retirada esté aprobada; actualmente permanecen retenidos incluso después de validar dos logins.
4. No incluir nunca `service_role`, secret keys, contraseñas, hashes ni salts reales en el repositorio o frontend.
5. Cualquier cambio de esquema debe hacerse con una migración nueva; no modificar tablas manualmente desde el Dashboard.

La migración de datos y el backend JIT están validados en staging. El frontend productivo sigue sin conectarse a Supabase; consultar `MIGRATION_STATUS.md` antes de cualquier corte.

## Aplicación con CLI (opción manual)

```bash
supabase login
supabase link --project-ref tefnzjvylcvffnorgzls
supabase db push --dry-run
supabase db push
```

Si ya vinculaste GitHub/Supabase para aplicar `supabase/migrations`, alcanza con publicar esta carpeta en la raíz de `parking-scanner` y revisar el job de integración antes de seguir.
