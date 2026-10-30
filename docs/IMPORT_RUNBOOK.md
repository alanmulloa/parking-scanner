# Runbook de importación y corte

## Estado actual

- Migraciones remotas `100` a `117` alineadas en el proyecto Supabase enlazado.
- El Excel se importó y se repitió una segunda vez sin duplicados.
- `legacy-auth-migrate` está desplegada y pasó la prueba sintética end-to-end.
- Las 77 credenciales reales permanecen retenidas y pendientes de primer login.
- No se cambió frontend, URL ni sistema Google productivo.

## 1. Preparación

1. Congelar una copia del XLSX y anotar SHA-256.
2. Crear un proyecto Supabase de staging o una rama aislada.
3. Aplicar migraciones y ejecutar `supabase db lint --linked --schema public`.
4. Configurar solo en el proceso seguro:

```bash
export SUPABASE_URL='https://...supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='...'
export COMMUNITY_SLUG='parking-comunidad'
export COMMUNITY_LEGACY_ID='LEGACY_COMMUNITY_DDBB_QR'
```

## 2. Dry-run obligatorio

```bash
cd tools/sheet-import
npm ci
node src/import.mjs --dry-run --file "/ruta/DDBB QR Comunidad.xlsx" --report reports/dry-run.json
```

El proceso debe devolver `valid: true`, cero errores y el checksum esperado. Los warnings se revisan y documentan.

## 3. Apply en staging

`APPLY` se bloquea si no se confirma el mismo checksum mostrado por dry-run:

```bash
node src/import.mjs --apply \
  --file "/ruta/DDBB QR Comunidad.xlsx" \
  --confirm-checksum a365ec50fa366a25ebbff0597ebbc257f8717eedc7cfeadb90cfba01fe99fecb \
  --report reports/apply-staging.json
```

No envía emails. El importador crea/actualiza por email y `(community_id, legacy_id)`, en lotes, y genera `migration_runs`. Repetir exactamente el mismo comando debe mantener los conteos sin duplicados.

## 4. Reconciliación

Comparar el reporte APPLY con el dry-run. Validar especialmente:

- 77 perfiles, miembros y credenciales pendientes;
- 77 viviendas y responsables;
- 35 vehículos, 31 QR, 31 slots y 4 motos sin slot;
- 1.170 auditorías y 23 referencias UUID nulas conservando ID legacy;
- cero filas en las cinco pestañas actualmente vacías;
- 8 claves de configuración.

## 5. Auth y RLS

1. Desplegar JIT solo en staging.
2. Probar primer y segundo login con cuentas ADMIN, CONTROL+PROPIETARIO y PROPIETARIO.
3. Intentar UUID de otra comunidad para cada rol; debe devolver cero filas o 403.
4. Probar que `anon`/`authenticated` no ejecutan RPC de credenciales.
5. Probar evidencia privada con URL firmada y confirmar que otro propietario no la ve.

## 6. Corte productivo

1. Ventana de solo lectura en Google.
2. Exportar XLSX final y repetir dry-run con su nuevo checksum.
3. Backup lógico de Supabase y export de `auth.users`/tablas.
4. APPLY final.
5. Reconciliar conteos y muestrear relaciones.
6. Activar Edge Function y cambiar el login frontend a la función JIT.
7. Habilitar el resto del frontend Supabase.
8. Mantener Google en solo lectura durante el periodo acordado.
9. Retirar credenciales legacy pendientes solo después de una política explícita de cierre.

## Rollback

- Antes del corte: no hay nada que revertir; Google sigue siendo productivo.
- Si falla APPLY: conservar `migration_runs`, corregir la causa y repetir; no truncar. Los upserts son idempotentes.
- Si falla JIT: devolver temporalmente el login al backend Google; no borrar la bóveda privada.
- Si falla el frontend: restaurar la URL/artefacto anterior; la importación no modifica Google.
- Si es necesario retirar datos de una importación de staging, restaurar el backup del proyecto aislado. No ejecutar `db reset`, `truncate` ni borrado masivo en producción.
- Las migraciones remotas no se reescriben. Toda corrección se publica como una migración nueva.

## Secretos y evidencias

El `service_role` solo vive en CI/terminal seguro. El bucket `parking-private` acepta JPEG, PNG, WebP y PDF hasta 10 MiB. Los objetos se guardan como `<community_uuid>/<incident_uuid>/<archivo>` y nunca como URL pública permanente.
