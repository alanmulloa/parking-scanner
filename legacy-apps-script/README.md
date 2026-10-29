# Bridge Apps Script para Parking Comunidad

Este bridge permite ejecutar desde `Configuración > Sistema` las funciones heredadas de Correo y Google Drive/Docs sin exponer secretos ni service roles al navegador.

## Identidades

- `installParkingBridgeMailWorkerUi`: ejecutar una vez desde la cuenta Google remitente prevista (`pakinggestioncomunidad@gmail.com`, salvo que la configuración estable indique otra).
- `installParkingBridgeDocumentWorkerUi`: ejecutar una vez desde la cuenta Google que tenga acceso a la carpeta principal de Drive.

Los bridge workers son independientes de los workers funcionales. Por eso pueden activar/desactivar y volver a instalar los workers funcionales desde la web.

## Secreto

Ejecutar `configureParkingLegacyBridgeSecretUi` una vez desde la Sheet y pegar el mismo secreto que se configura como `LEGACY_BRIDGE_SECRET` en Supabase.

## Despliegue seguro en preproducción

Añadir `LegacyBridge.gs` al mismo proyecto Apps Script productivo y guardar el proyecto.

**No actualizar todavía el deployment histórico** que atiende la URL actual y los QR. Crear un segundo deployment Web App llamado, por ejemplo, `Bridge preproducción` y usar su nueva URL `/exec` como `LEGACY_APPS_SCRIPT_URL` en Supabase.

`doGet()` no se modifica. El bridge añade únicamente `doPost()`. Más adelante, durante el cutover, el deployment histórico se actualizará por separado para hacer el redirect compatible con `?q=`.
