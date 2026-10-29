# Parking Comunidad — Plan de pruebas de preproducción Supabase

## Criterio de salida

La fase solo puede declararse completa si el sistema puede utilizarse de punta a punta con ADMIN, CONTROL, PROPIETARIO y ROOT, sin depender de `google.script.run` para lógica funcional productiva.

## 1. Datos

- Reconciliar último XLSX disponible contra staging.
- Repetir con XLSX fresco inmediatamente antes del futuro cutover.
- Verificar usuarios por `legacy_id` y email.
- Verificar viviendas por `legacy_id` y ubicación.
- Verificar vehículos, slot, estado, QR y vivienda.
- Verificar auditoría por `legacy_id`/identificador histórico.
- Cero FK rotas.
- Cero slot duplicado activo en una vivienda.
- Cero matrículas habituales duplicadas globalmente.

## 2. Auth JIT

Caso pendiente legacy:

1. login con password actual;
2. sesión 200;
3. logout;
4. segundo login;
5. login nativo Supabase;
6. misma contraseña;
7. credencial legacy retenida durante estabilización.

Fallos:

- password incorrecta;
- bloqueo según política;
- usuario inactivo/no autorizado.

## 3. ROOT

- Login con contraseña ROOT actual.
- Password errónea rechazada.
- ROOT ve Sistema.
- ADMIN no ve Sistema.
- ADMIN no puede otorgarse ROOT.
- ROOT no aparece como propietario/vivienda.
- ROOT no altera conteo de usuarios normales.
- Logout y refresh correctos.
- Acciones técnicas auditables.

## 4. ADMIN

### Viviendas

- listado;
- búsqueda;
- detalle;
- responsable;
- vehículos;
- edición permitida.

### Usuarios

- listado;
- viviendas asociadas;
- edición;
- cerrar sesiones;
- reset/generación password mediante Supabase Auth.

### Vehículos

- alta coche sin vehículos → Slot 1;
- alta segundo coche → Slot 2;
- tercer coche → Desasignado;
- alta moto → Activo sin slot/QR;
- matrícula duplicada en cualquier estado → bloquear;
- editar mismo vehículo sin falso duplicado;
- liberar slot;
- reasignar slot ocupado;
- suspensión;
- baja;
- reactivación por solicitud;
- revocar QR;
- renovar QR;
- reemplazo;
- acciones masivas.

### Configuración

- ADMIN modifica Identidad/comunidad.
- ADMIN no accede a Sistema.

### Auditoría

- lectura;
- acciones nuevas generan registro real.

## 5. CONTROL

### Scanner QR

- autorizado;
- QR revocado;
- Suspendido;
- Baja;
- Desasignado;
- moto → usar matrícula;
- vivienda no activa;
- token inexistente.

### Matrícula

- habitual válida;
- temporal vigente;
- temporal no vigente;
- matrícula no registrada;
- suspendido;
- baja;
- QR revocado en coche;
- moto válida.

### Incidencias

- crear desde resultado de control;
- foto/evidencia cuando aplique;
- seguimiento;
- no duplicar misma relación el mismo día.

## 6. PROPIETARIO

- login;
- solo sus viviendas;
- solo sus vehículos;
- alta/edición según permisos estables;
- auto-slot;
- moto;
- temporales;
- liberar/asignar slot dentro de permisos;
- solicitudes;
- incidencias visibles según contrato;
- no leer/modificar UUID ajeno.

## 7. Temporales

- mismo día permitido;
- `Hasta >= Desde`;
- no solapar mismo vehículo;
- no usar matrícula habitual propia;
- no usar matrícula habitual de otro vehículo Activo;
- no solapar misma temporal entre vehículos;
- Suspendido no puede crear/editar/extender;
- al dejar Activo se aplica regla estable de anulación vigente.

## 8. Incidencias vinculadas

### QR de A usado por B, distinto propietario autorizado

Esperar:

- Uso indebido: Cesión de QR sobre A.
- Uso indebido: Uso de QR ajeno sobre B.

### B suspendido/de baja/no autorizado

Añadir Acceso no autorizado correspondiente.

### Mismo propietario

- QR no corresponde con matrícula sobre observado.
- Si observado no autorizado, añadir Acceso no autorizado.

### Matrícula C no registrada usando QR A

- Cesión de QR.
- Matrícula no registrada.

### Repetición

- misma relación el mismo día: no duplicar;
- nuevo día: seguimiento;
- otro vehículo en mismo día: permitir nueva relación/seguimiento según evento.

## 9. Solicitudes

Solo tipos estables salvo decisión funcional expresa:

- Reactivación vehículo;
- Renovación QR;
- Permanencia prolongada.

Verificar:

- creación;
- Abierta;
- aprobación;
- rechazo;
- efectos reales sobre vehículo/QR;
- no solapar permanencias aprobadas;
- auditoría.

## 10. RLS y seguridad

Ataques directos por UUID:

- propietario → vivienda ajena;
- propietario → vehículo ajeno;
- propietario → solicitud ajena;
- control → administración;
- ADMIN → ROOT;
- anon → tablas privadas;
- cambio de membership/role no autorizado.

No aceptar una prueba basada únicamente en UI.

## 11. Drive / Docs

- Apps Script conserva acceso a carpeta.
- Verificar estructura.
- Generar documento de incidencia usando datos Supabase.
- Worker procesa cola.
- Documento vinculado correcto.
- Reprocesamiento idempotente.

## 12. Correos

- worker autorizado único;
- cuenta remitente correcta;
- prueba de email;
- alta nueva;
- reset de password nuevo;
- reintento de fallo;
- usuario JIT existente no recibe password nuevo sin acción administrativa.

## 13. Responsive

Móvil:

- login;
- CONTROL scanner;
- matrícula;
- incidencia rápida;
- vehículos legibles;
- menú adecuado por rol.

ADMIN móvil no necesita exponer auditoría/diagnóstico si el estable no lo hace.

## 14. Query parameter QR

Preproducción debe aceptar `?q=<token>` y conservarlo:

- entrada deslogueado;
- login;
- navegación;
- refresh;
- resolución final del QR.

## 15. Regresión de la versión estable

Utilizar como contrato las pruebas FIX11.29 y las regresiones funcionales vigentes.

No reutilizar expectativas históricas que fueron reemplazadas, especialmente el antiguo acceso de ADMIN a Sistema.

## 16. Criterio PREPRODUCCIÓN FUNCIONAL: SÍ

Todos los bloques críticos deben estar OK:

- datos;
- JIT;
- ROOT;
- RLS;
- ADMIN;
- CONTROL;
- PROPIETARIO;
- vehículos;
- QR;
- temporales;
- scanner;
- incidencias;
- solicitudes;
- auditoría;
- Drive/Docs;
- correos;
- responsive.

Lo único que debe quedar fuera es el cutover productivo y la última sincronización de datos.
