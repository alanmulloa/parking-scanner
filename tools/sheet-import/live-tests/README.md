# Preproduction live tests

Estos tests están diseñados para un staging que contiene datos reales.

## 1. Solo lectura sobre datos reales

No modifica ninguna tabla:

```bash
cd tools/sheet-import
node --env-file=.env live-tests/preproduction-readonly.mjs
```

Valida conteos del snapshot, ROOT aislado, vehículos, slots, QR, temporales,
relaciones y ausencia de fixtures residuales.

## 2. E2E con fixtures sintéticos

Crea únicamente usuarios/viviendas/vehículos con prefijo `PREPROD_TEST_`,
ejecuta flujos reales ADMIN/CONTROL/PROPIETARIO y limpia todo en `finally`:

```bash
cd tools/sheet-import
node --env-file=.env live-tests/preproduction-fixtures.mjs
```

Flujos cubiertos:

- RLS propietario y aislamiento de vivienda ajena.
- ADMIN sin acceso ROOT.
- Auto-slot 1/2, tercer coche Desasignado y Moto sin slot/QR.
- CONTROL sin edición directa de vehículos.
- Temporal de un solo día y anulación al dejar de estar Activo.
- Solicitud de renovación QR y aprobación ADMIN.
- Scanner QR/matrícula real sobre un vehículo TEST.
- PROPIETARIO sin acceso al scanner.
- Incidencia vinculada creada por CONTROL sobre fixtures.
- Limpieza automática y comprobación de residuos.

No utiliza viviendas, vehículos, solicitudes ni incidencias reales para operaciones de escritura.
