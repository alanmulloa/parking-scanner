# Parking Comunidad — Clasificación del menú administrativo del Google Sheet

## Principio

El objetivo no es copiar el menú de Google Sheets a Supabase. Cada función se clasifica según su utilidad en la arquitectura futura.

Estados:

- **CONSERVAR**: sigue teniendo sentido en Apps Script.
- **ADAPTAR A SUPABASE**: función útil, pero debe dejar de leer/escribir Sheets como fuente de verdad.
- **MIGRAR**: mejor moverla a Supabase/RPC/frontend administrativo.
- **RETIRAR**: solo tenía sentido porque Sheets era la base de datos.
- **SOLO PREPRODUCCIÓN**: función destructiva o de pruebas.
- **LEGACY**: conservar temporalmente para rollback, sin uso productivo nuevo.

## Menú actual

### Preparar hojas → RETIRAR / LEGACY

Función: `setupParking`.

Actualmente:

- crea pestañas faltantes;
- reescribe encabezados;
- normaliza/migra datos de Sheets;
- guarda `SPREADSHEET_ID`;
- migra temporales legacy.

Con PostgreSQL/Supabase estas responsabilidades pasan a:

- migrations;
- constraints;
- seed/importador;
- versionado de schema.

**Decisión:** quitar del menú productivo futuro. Mantener código únicamente durante rollback/estabilización.

### Importar viviendas Flores de Riviera → RETIRAR DEL MENÚ PRODUCTIVO / REEMPLAZAR

Función: `importFloresDeRivieraHousing`.

Actualmente contiene un catálogo fijo de 77 viviendas y crea las faltantes en la pestaña Viviendas.

En Supabase, el catálogo fijo debe administrarse mediante migración/seed/importador idempotente, no mediante una opción manual de Sheet.

**Decisión:** no conservar como operación normal. Reemplazar por proceso idempotente de datos en Supabase. Mantener legacy durante rollback.

### Archivos > Configurar carpeta principal → CONSERVAR / ADAPTAR

Apps Script sigue siendo apropiado para Drive.

Debe conservar la configuración de carpeta, pero los documentos futuros deben obtener datos desde Supabase.

### Archivos > Verificar estructura Drive → CONSERVAR

No depende de Sheets como base de datos.

### Archivos > Probar Google Docs → CONSERVAR / ADAPTAR

Conservar la integración. Adaptar la lectura de incidencias/contexto a Supabase.

### Archivos > Activar procesamiento automático → CONSERVAR

Instala trigger del worker documental.

### Archivos > Ver estado procesamiento automático → CONSERVAR

### Archivos > Desactivar procesamiento automático → CONSERVAR

### Archivos > Generar documentos faltantes → ADAPTAR A SUPABASE

La lógica documental es válida, pero las incidencias faltantes deben determinarse contra Supabase.

### Archivos > Regenerar diseño de documentos → ADAPTAR A SUPABASE

### Archivos > Procesar documentos pendientes → CONSERVAR / ADAPTAR COLA

El worker puede seguir en Apps Script. La cola debe estar coordinada con Supabase o ser una cola técnica de Apps Script sin duplicar fuente de verdad funcional.

### Accesos > Probar correo de bienvenida → CONSERVAR

Útil para validar remitente/plantilla.

No debe enviar passwords a usuarios migrados por JIT salvo operación expresa de alta/reset.

### Accesos > Ver modo de remitente → CONSERVAR

### Accesos > Configurar no-reply real (Workspace) → CONSERVAR

### Accesos > Activar worker de correos → CONSERVAR

### Accesos > Ver estado worker → CONSERVAR

### Accesos > Desactivar worker → CONSERVAR

### Accesos > Ver estado correos de acceso → ADAPTAR

La cola debe representar eventos del sistema Supabase, no solo filas de Sheets.

### Accesos > Procesar correos ahora → CONSERVAR / ADAPTAR

### Accesos > Reintentar correos fallidos → CONSERVAR / ADAPTAR

### Vehículos > Vista previa matrículas duplicadas → MIGRAR A SUPABASE

La capacidad es útil y la versión estable valida unicidad global.

Debe consultar `vehicles` en Supabase y relaciones reales.

### Vehículos > Consolidar duplicados seguros → MIGRAR A SUPABASE

Debe implementarse como operación backend transaccional y auditada. No ejecutar contra Sheet después del cutover.

### Preproducción > Vista previa limpieza → SOLO PREPRODUCCIÓN

### Preproducción > LIMPIAR BBDD de pruebas → SOLO PREPRODUCCIÓN

Nunca debe apuntar al proyecto productivo. Debe existir una protección explícita de entorno/proyecto.

### Establecer/restablecer contraseña → REEMPLAZAR PARA SUPABASE AUTH

Función actual: `configureUserPassword`.

Hoy modifica hash/salt en Sheet y encola email de contraseña.

Después del cutover:

- Supabase Auth es la autoridad;
- la operación debe ejecutarse desde backend seguro;
- no debe exponer service role;
- debe invalidar/actualizar la sesión según política;
- debe auditarse;
- nunca debe dejar password Sheet y Supabase divergentes.

La opción puede seguir existiendo como utilidad administrativa, pero su implementación debe ser nueva.

## Triggers a preservar/adaptar

### Worker de documentos

Handler: `processIncidentDocumentQueue`.

**Decisión:** conservar mientras Apps Script siga siendo integración con Google Docs/Drive.

### Worker de correos

Handler: `processUserWelcomeEmailQueueWorker`.

La versión estable incluye control de trigger/cuenta autorizada.

**Decisión:** conservar, adaptar origen de cola/eventos a Supabase.

### onOpen

Debe conservarse para presentar el menú administrativo reducido.

### doGet

Durante preproducción productiva actual no se toca.

En el futuro cutover puede convertirse en launcher/redirección conservando el mismo deployment y `?q=`.

## Menú objetivo recomendado después del cutover

```text
Parking Comunidad
├── Archivos
│   ├── Configurar carpeta principal
│   ├── Verificar estructura Drive
│   ├── Probar Google Docs
│   ├── Activar / Estado / Desactivar worker
│   ├── Generar documentos faltantes
│   └── Procesar pendientes
├── Comunicaciones
│   ├── Probar correo
│   ├── Estado remitente
│   ├── Activar / Estado / Desactivar worker
│   ├── Procesar pendientes
│   └── Reintentar fallidos
├── Mantenimiento
│   ├── Detectar matrículas duplicadas (Supabase)
│   └── Consolidar duplicados (Supabase)
└── Usuarios
    └── Establecer/restablecer contraseña (Supabase Auth)
```

No incluir en producción:

- Preparar hojas.
- Importar catálogo fijo de viviendas como operación manual ordinaria.
- Limpieza de BBDD de pruebas.
