# Estado de migración a Supabase

Fecha de corte del informe: 2026-10-28

Rama: `supabase-poc`

Proyecto Supabase: `tefnzjvylcvffnorgzls`

Producción: **sin cambios**

## Resumen ejecutivo

La migración de datos está cerrada y reconciliada. El backend JIT de contraseñas está desplegado y validado. La aplicación web todavía no tiene paridad funcional: la POC cubre parte de Viviendas, Vehículos, slots, QR administrativo y temporales, pero el login aún evita la Edge Function y faltan Control/escaneo, incidencias, solicitudes, auditoría, configuración y dashboard. Por tanto, **no debe sustituirse todavía la aplicación estable ni cambiarse el `index.html` productivo**.

## Matriz por módulo

| Módulo | Estado | Evidencia actual | Siguiente paso mínimo |
|---|---|---|---|
| Importación Sheet → Supabase | COMPLETE | Reconciliación 24/24; 77 usuarios, 77 viviendas, 35 vehículos y 1.170 auditorías, diferencias 0 | Congelar el importador salvo correcciones verificadas |
| Esquema, FKs y RLS | COMPLETE | Migraciones 100–119 alineadas; lint remoto sin errores; RLS de 68 propietarios puros validada por migración 117 | Mantener tests de regresión por nueva migración |
| Vault de credenciales legacy | COMPLETE | 78 filas contando TEST; hash/salt privados y retenidos; 0 purgas | Definir política de purga futura fuera de esta fase |
| Edge Function JIT | COMPLETE | Primer login JIT, logout y segundo login nativo OK; prueba sintética y TEST OK; `deno check` OK | Mantener función limpia y CORS restringido |
| Login del frontend | BLOCKING | `supabase-poc-adapter.js` usa `sb.auth.signInWithPassword` directamente; no llama `legacy-auth-migrate` | Integrar la Edge Function, instalar la sesión devuelta y probar desde la UI |
| Bootstrap, perfil y roles | PARTIAL | Lee `profiles` y `community_members`; los ajustes públicos están hardcodeados | Cargar comunidad/configuración real y manejar membresías múltiples explícitamente |
| Usuarios | PENDING | No existe ruta Supabase para listado/alta/edición/estado en el router de la POC | Implementar operaciones con backend seguro; nunca exponer `service_role` |
| Viviendas | PARTIAL | Listado y guardado implementados; opciones de propietario básicas | Completar todas las acciones legacy, validaciones y pruebas por rol |
| Vehículos | PARTIAL | Listado/guardado, slots, renovar/revocar QR, reemplazo y acciones masivas implementados | Eliminar duplicación del adaptador y ejecutar regresión integral de estados/slots/QR |
| Matrículas temporales | PARTIAL | CRUD, extensión/anulación y reglas básicas implementadas | Consolidar una sola implementación y probar solapamientos/RLS desde UI |
| QR administrativo | PARTIAL | Tokens y estados se guardan; renovar/revocar están conectados | Verificar generación, impresión, centrado, densidad y lectura real de todos los QR |
| Escáner QR y Control | BLOCKING | `scanner/` solo acepta una URL HTTPS con `q` y redirige; no consulta Supabase ni registra control | Implementar resolución segura de token, contexto del vehículo y registro de control |
| Creación automática de incidencias | BLOCKING | El router Supabase no implementa acciones de incidencias; era la función esencial de la versión estable | Migrar primero el flujo QR/matrícula → validación → incidencia con pruebas E2E |
| Incidencias y seguimientos | PENDING | La UI legacy existe, pero las acciones caen en “todavía no fue migrada” | Implementar listar/crear/seguir/cerrar y efectos transaccionales |
| Solicitudes/aprobaciones | PENDING | `managerData('vehicles')` devuelve `requests: []` | Implementar workflow y transacciones de aprobación/rechazo |
| Auditoría funcional | PENDING | El histórico está importado, pero la POC no lista ni genera eventos de negocio | Crear RPCs/triggers auditables y pantalla de consulta |
| Configuración | PENDING | `POC_SETTINGS` es constante local | Leer/escribir `community_settings` según rol |
| Dashboard/resumen | PENDING | No hay rutas Supabase específicas | Crear una consulta/RPC agregada y evitar múltiples round-trips |
| Evidencias/fotos | PARTIAL | Modelo y endurecimiento de storage existen en migraciones | Integrar subida, lectura firmada y borrado desde incidencias |
| GitHub Pages / URL final | PENDING | `supabase-poc.html` es separado; `index.html` sigue redirigiendo al escáner | Publicar staging aislado y cortar solo tras aceptación completa |

## Causa del 401 JIT

El 401 anterior ocurrió en la comparación de credencial: la contraseña introducida no coincidía con el hash legacy importado en ese momento. Se comprobó que el usuario se encontraba, el salt existía, `iterations` era 1000 y el algoritmo v2 era correcto. Tras actualizar de forma controlada el hash/salt desde la Sheet vigente, la contraseña coincidió y el primer y segundo login pasaron. No fue necesario cambiar el algoritmo, resetear la contraseña, recrear el usuario ni purgar credenciales.

## Camino mínimo hacia un staging funcional

1. Conectar el formulario de login a `legacy-auth-migrate` y probar sesión, recarga y logout.
2. Migrar como bloque atómico la función principal: escaneo QR/matrícula, resolución del vehículo, registro de control y creación/seguimiento de incidencias.
3. Completar incidencias, solicitudes y auditoría antes de ampliar UX.
4. Consolidar el adaptador: quitar implementaciones temporales duplicadas y cubrir cada acción con tests.
5. Ejecutar una matriz E2E por rol (ADMIN, CONTROL, PROPIETARIO y combinados), móvil/cámara incluidos.
6. Publicar una URL de staging distinta, comparar con la versión estable y definir rollback.
7. Solo después, preparar el corte controlado; no redirigir producción durante esta fase.

## Criterio de salida para producción

No habrá corte hasta que login JIT desde UI, escaneo, controles, incidencias, seguimiento, solicitudes, QR, slots, temporales, RLS y auditoría pasen pruebas E2E sin regresiones respecto de `1.2.13.14_ESTABLE_INCIDENCIAS_FIX11.29_DEPLOYFIX`.
