# Bridge seguro Supabase ↔ Apps Script

## Objetivo

Mantener durante la transición las integraciones ya probadas de Google Mail / Drive / Docs, pero administrarlas desde la nueva aplicación.

Flujo:

`ROOT web → parking-admin → HMAC → Apps Script doPost → cola bridge → worker Google correcto → función legacy`

El secreto solo existe en Supabase Secrets y Script Properties; nunca se expone al frontend.

## Acciones de Correo

- Probar correo de acceso.
- Consultar modo de remitente.
- Activar/desactivar no-reply real.
- Activar/ver/desactivar worker de correo.
- Consultar estado de cola.
- Procesar cola manualmente.
- Reintentar fallidos.

El bridge de correo debe instalarse con la cuenta remitente. Esto evita que una llamada del Web App cambie la identidad real de envío.

## Acciones de Drive / Docs

- Configurar carpeta principal.
- Verificar/preparar estructura Drive.
- Probar Google Docs.
- Activar/ver/desactivar worker documental.
- Generar documentos faltantes.
- Regenerar diseño.
- Procesar pendientes.

El bridge documental debe instalarse con una cuenta con permisos sobre la carpeta configurada.

## Importante para el cutover

`generateMissing` y `regenerateAll` continúan leyendo las incidencias legacy del Sheet mientras esta integración siga en fase heredada. No deben considerarse migradas a Supabase todavía. Antes de retirar el Sheet como fuente auxiliar habrá que adaptar la generación documental a datos Supabase/OneDrive o mantener sincronización de transición.

## Secrets Supabase

- `LEGACY_APPS_SCRIPT_URL`: URL `/exec` del deployment separado **Bridge preproducción**. No usar todavía la URL histórica productiva.
- `LEGACY_BRIDGE_SECRET`: secreto aleatorio de al menos 32 caracteres.

## Seguridad

- HMAC-SHA256.
- timestamp máximo 5 minutos.
- nonce con protección de replay.
- comandos ROOT-only en `parking-admin`.
- allowlist cerrada de comandos.
- cada solicitud queda auditada en Supabase.


## Despliegue recomendado durante preproducción

Añadir `LegacyBridge.gs` al mismo proyecto Apps Script productivo, pero **no actualizar el deployment histórico** que hoy atiende usuarios y QR.

Crear un segundo deployment Web App, por ejemplo `Bridge preproducción`, con una nueva URL `/exec`. Ese deployment expone el `doPost()` firmado y comparte el mismo código, Script Properties y workers del proyecto, mientras la URL histórica sigue ejecutando su versión estable.

Cuando llegue el cutover, el deployment histórico se actualizará aparte para convertir su `doGet()` en redirect compatible con `?q=`. El bridge puede seguir usando su deployment separado o consolidarse después.
