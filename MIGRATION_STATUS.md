# Estado de migración a Supabase

Fecha del informe: 2026-10-29

Rama objetivo: `supabase-poc`

Proyecto Supabase: `tefnzjvylcvffnorgzls`

Producción Apps Script/Sheet: **sin cambios**

## Resumen ejecutivo

La reconciliación fresca del 29/10 quedó cerrada en staging: 77 usuarios, 77 viviendas, 35 vehículos y 1.173 registros de auditoría, sin diferencias en el reporte final. El frontend de preproducción ya tiene cobertura para las 49 acciones utilizadas por la UI y se completó la paridad local de JIT, ROOT, roles, vehículos, solicitudes, incidencias vinculadas, auditoría completa, herramientas administrativas esenciales y QR `?q=`.

El estado actual es **LISTO EN CÓDIGO / PENDIENTE DE APLICACIÓN Y E2E REMOTO**. Las migraciones 123–127 y las Edge Functions modificadas en este tramo no se han aplicado desde este entorno. No debe tocarse producción todavía.

## Datos reconciliados

Última reconciliación fresca registrada en el repo:

- Usuarios: 77 / 77
- Viviendas: 77 / 77
- Vehículos: 35 / 35
- Auditoría: 1.173 / 1.173
- Diferencias: 0
- Alias de identidad por cambio de email: resuelto
- 3 eventos recientes de auditoría: incorporados

El XLSX deberá repetirse una última vez justo antes del futuro cutover porque Apps Script sigue siendo la producción activa.

## Matriz

| Módulo | Estado | Evidencia / observación |
|---|---|---|
| Reconciliación Sheet → Supabase | COMPLETO | Reporte fresco 29/10, cero diferencias |
| Importador idempotente | COMPLETO PARA STAGING | Reconciliación fresca ejecutada; volver a usar con XLSX final antes del corte |
| Auth JIT usuarios | COMPLETO EN STAGING PREVIO | Primer login, logout y segundo login nativo validados anteriormente |
| Login JIT desde frontend | LISTO EN CÓDIGO | `supabase-final-adapter.js` llama `legacy-auth-migrate` e instala sesión |
| ROOT técnico | LISTO EN CÓDIGO | Migración 127 + provisioning seguro + root-first login con mismo email visible |
| ROOT contraseña dual mismo email | LISTO EN CÓDIGO | PBKDF2 privado discrimina ROOT antes de Auth, evitando fallos artificiales |
| ROOT / ADMIN separación | LISTO EN CÓDIGO | ROOT sin membership, Sistema solo ROOT, ADMIN no puede crear/modificar ROOT |
| Sesiones / revocación | LISTO EN CÓDIGO | Migración 122 + acciones admin |
| Bootstrap / roles | LISTO EN CÓDIGO | CanConfigure/CanSystem y roles funcionales ROOT corregidos |
| Viviendas | LISTO EN CÓDIGO | Listado/detalle/admin + guards de rol |
| Usuarios | LISTO EN CÓDIGO | Alta/edición/reset/cierre sesiones vía `parking-admin`; ROOT excluido |
| Vehículos / slots | LISTO EN CÓDIGO | RPC `save_parking_vehicle` + reglas auto-slot / estados |
| Motos | LISTO EN CÓDIGO | Activa sin slot/QR |
| Temporales | LISTO EN CÓDIGO | Owner/Admin, mismo día permitido, CONTROL sin escritura |
| QR administrativo | LISTO EN CÓDIGO | Revocar/renovar/reemplazar + cierre de solicitudes relacionado |
| Scanner QR/matrícula | LISTO EN CÓDIGO | RPC de control + `?q=` preservado en preproducción |
| Incidencias vinculadas | LISTO EN CÓDIGO | A+B, A+B suspendido, mismo propietario y matrícula desconocida cubiertos por tests puros |
| Seguimientos | LISTO EN CÓDIGO | Regla diaria por relación/evento y evidencia compartida |
| Cierre de incidencias | LISTO EN CÓDIGO | Acciones/targets corregidos según versión estable |
| Solicitudes | LISTO EN CÓDIGO | Solo 3 tipos estables; create/resolve con validaciones de negocio |
| Auditoría | LISTO EN CÓDIGO | Lectura paginada >1000; ROOT usa email técnico visible |
| Configuración | LISTO EN CÓDIGO | `community_settings`, logo a Storage |
| Consistencia | LISTO EN CÓDIGO | report/fix RPC preparados |
| Importación propietarios | LISTO EN CÓDIGO | preview/apply en `parking-admin`; en preprod no envía emails reales |
| Responsive | HEREDADO / PENDIENTE E2E | Reutiliza bundle estable; validar móvil real |
| Drive / Docs | PENDIENTE INTEGRACIÓN POSTERIOR | Mantener Apps Script y adaptar fuente a Supabase antes del cutover |
| Worker de correos | PENDIENTE INTEGRACIÓN POSTERIOR | Preprod no envía credenciales nuevas; Apps Script worker debe adaptarse |
| Menú Sheet | AUDITADO | Ver `docs/LEGACY_SHEET_FUNCTIONS.md` |
| URL histórica Apps Script | NO TOCAR EN PREPRODUCCIÓN | Preparar launcher solo en cutover aprobado |
| TinyURL | NO TOCAR | Debe preservarse |
| QR históricos | PENDIENTE E2E REAL | Código conserva `?q=`; probar QR físico antes del GO |

## Cambios locales posteriores a la última aplicación remota conocida

Preparados en este repo:

- `20261029012300_preproduction_admin_completeness.sql`
- `20261029012400_incident_linked_event_parity.sql`
- `20261029012500_owner_vehicle_request_parity.sql`
- `20261029012600_vehicle_request_lifecycle_parity.sql`
- `20261029012700_technical_root_login.sql`

No afirmar que están en remoto hasta ejecutar `supabase migration list` / `db push` desde el workspace con acceso real.

Edge Functions a desplegar/actualizar en staging:

- `legacy-auth-migrate`
- `parking-admin`

## Tests locales estáticos/puros actuales

Pasan:

- `adapter-action-coverage.mjs`: 49/49 acciones cubiertas
- `preproduction-completeness.mjs`
- `incident-parity.mjs`
- `vehicle-request-parity.mjs`
- `role-parity.mjs`
- `root-parity.mjs`
- `node --check` de adapters y provisioning ROOT

Limitaciones de este entorno:

- no hay `deno` para `deno check` de Edge Functions;
- no hay Postgres/Supabase local para ejecutar las migraciones;
- no se ha hecho E2E contra el proyecto remoto desde esta sesión.

## Criterio para declarar PREPRODUCCIÓN FUNCIONAL

Antes de marcarla como completada deben ejecutarse en Supabase real:

1. Confirmar estado remoto de migraciones 120–122.
2. Aplicar 123–127 en orden.
3. Desplegar `legacy-auth-migrate` y `parking-admin`.
4. Aprovisionar ROOT con mismo email/contraseña técnica mediante `tools/sheet-import/root-provision.mjs`.
5. Publicar `preproduccion.html` en URL staging.
6. Configurar `ALLOWED_ORIGIN` para staging.
7. E2E ROOT, ADMIN, CONTROL y PROPIETARIO.
8. Probar QR físico y matrícula.
9. Probar incidencias vinculadas y seguimiento.
10. Probar solicitudes, vehículos, slots, temporales y auditoría.
11. Validar móvil real.

Solo entonces cambiar este estado a `PREPRODUCCIÓN FUNCIONAL: SÍ`.

## Producción

No tocar todavía:

- deployment Apps Script productivo;
- URL histórica `/exec`;
- TinyURL;
- Sheet productivo;
- QR impresos;
- `main`;
- credenciales legacy retenidas.

El cutover posterior deberá comenzar con un XLSX fresco + freeze breve + dry-run + importación/reconciliación final.
