# Sistema v2 y modo mantenimiento

## Objetivo

Completar `Configuración > Sistema` para la preproducción Supabase sin retirar todavía las integraciones productivas de Apps Script que siguen siendo necesarias durante el primer cutover.

## Qué cambia

- Frontend identificado como `2.0.0-preprod.1`.
- Estado técnico con tiempos reales de PostgreSQL/Supabase, Auth/RLS y Edge Functions.
- Eliminación de `Hojas` y `Benchmark Sheets` del diagnóstico de la aplicación.
- Conteos reales: usuarios, ROOT, viviendas, vehículos y auditoría.
- Modo mantenimiento controlado exclusivamente por ROOT.
- Pantalla de mantenimiento pública y bloqueo del scanner.
- Favicon y `apple-touch-icon` derivados de `LogoUrl`.
- Scanner sin fallback al antiguo `alanmulloa.github.io/parking-scanner`.
- Integraciones heredadas de Correo y Google Drive/Docs visibles como dependencias temporales, sin simular que la web puede administrarlas todavía.

## Integraciones heredadas preservadas

Durante el primer cutover no se modifica su funcionamiento en Apps Script:

### Correo

- prueba de bienvenida;
- modo de remitente / no-reply;
- worker de correos;
- estado y procesamiento manual;
- reintento de fallidos.

### Google Drive / Docs

- carpeta principal;
- verificación de estructura;
- prueba Google Docs;
- worker documental;
- generación de documentos faltantes;
- regeneración de diseño;
- procesamiento de pendientes.

La web solo informa de esta dependencia temporal. La migración de estas integraciones se hará por separado para no romper servicios que hoy están operativos.

## Migración 128

`20261029012800_system_v2_maintenance.sql` añade:

- `parking_public_state()` para consultar mantenimiento antes del login;
- `parking_set_maintenance(...)`, exclusivo ROOT y auditado;
- `parking_system_ping()`, exclusivo ROOT;
- `root_system_status()` actualizado a migración 128;
- `root_system_diagnostics()` actualizado.

## Despliegue

1. Aplicar migración 128.
2. Redesplegar `parking-admin` porque incorpora `systemPing`.
3. Publicar la branch `supabase-poc` en GitHub Pages.
4. Forzar recarga del navegador.
5. Entrar como ROOT y abrir `Configuración > Sistema`.
6. Ejecutar `Prueba rápida` y `Diagnóstico completo`.
7. Probar activar mantenimiento.
8. En una ventana incógnita verificar que se muestra mantenimiento y el scanner no inicia la cámara.
9. Desde la pantalla de mantenimiento probar `Acceso técnico ROOT` y desactivar mantenimiento.

## Seguridad

- `parking_set_maintenance` valida `private.is_root()` en PostgreSQL.
- ADMIN normal no puede cambiar mantenimiento.
- El cambio de mantenimiento se registra en `audit_log`.
- Durante mantenimiento, el frontend bloquea acciones para usuarios no ROOT y el scanner consulta el estado público antes de abrir la cámara.
- Correo y Drive no se modifican en este entregable.
