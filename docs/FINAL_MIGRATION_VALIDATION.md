# Validación final Sheet → Supabase

Fecha: 2026-10-28

Fuente: `DDBB QR Comunidad.xlsx`

SHA-256: `a365ec50fa366a25ebbff0597ebbc257f8717eedc7cfeadb90cfba01fe99fecb`

Estado de datos: **OK (24/24 controles)**

Estado Auth/JIT: **OK en prueba sintética y cuenta TEST**

Producción: **sin cambios y sin corte**

El reporte reproducible completo está en `tools/sheet-import/reports/final-validation.json`.

## Reconciliación

| Entidad/control | Sheet | Supabase | Diferencia |
|---|---:|---:|---:|
| Usuarios importados | 77 | 77 perfiles + 77 Auth | 0 |
| Viviendas | 77 | 77 | 0 |
| Vehículos | 35 | 35 | 0 |
| Auditoría | 1.170 | 1.170 | 0 |
| Emails duplicados | 0 | 0 | 0 |
| Matrículas duplicadas | 0 | 0 | 0 |
| QR duplicados | 0 | 0 | 0 |
| Conflictos de slot | 0 | 0 | 0 |
| Relaciones no resueltas | 0 | 0 | 0 |
| IDs legacy duplicados | 0 | 0 | 0 |

Existe una cuenta TEST intencional fuera del conjunto importado. Por eso el proyecto contiene 78 filas de perfil, membresía, Auth y vault en total, pero la reconciliación de la Sheet sigue siendo exactamente 77/77. La cuenta TEST no se contabiliza como diferencia ni como registro productivo.

## Usuarios, perfiles y acceso a viviendas

- Los 77 usuarios de la Sheet resuelven a `auth.users`, `profiles` y `community_members`.
- No hay emails duplicados ni usuarios importados en una comunidad incorrecta.
- Roles preservados: ADMIN 1, CONTROL 8 y PROPIETARIO 76.
- Los 8 usuarios CONTROL + PROPIETARIO conservan ambos roles.
- Los 68 propietarios puros fueron validados por impersonación de `auth.uid()` en la migración transaccional 117. Cada uno ve exactamente sus viviendas; fallos: 0.
- CONTROL + PROPIETARIO conserva intencionadamente la visibilidad operativa adicional de CONTROL.

## Viviendas

- 77 viviendas, todas en la comunidad importada y sin duplicados.
- Responsable legacy/email convertido al UUID correcto en los 77 casos.
- Ninguna vivienda perdió un responsable presente en la Sheet.
- Bloque, planta, apartamento, estado y observaciones coinciden fila a fila.
- Se preservan sin reinterpretar `Porteria`, `Ático`, `Baja` y `-`.

## Vehículos

- 35 vehículos y 0 diferencias fila a fila.
- Vivienda, matrícula, `legacy_id`, slot, tipo, estado, marca, modelo, observaciones, QR token y estado QR coinciden.
- 20 vehículos usan Slot 1, 11 Slot 2 y 4 no usan slot.
- Las cuatro motos siguen Activo, sin slot y sin QR.
- Los 31 coches con QR conservan exactamente su token legacy.
- No hay matrículas, QR, `legacy_id` ni slots duplicados inesperadamente.

## Relaciones y seguridad

Todos los controles devolvieron cero: vehículos sin vivienda, viviendas sin responsable, perfiles sin membresía, relaciones cross-community, temporales sin vehículo, seguimientos sin incidencia y controles con usuario o vehículo inexistente.

Las FKs simples y compuestas siguen activas. Las compuestas incluyen `community_id`. El linter remoto revisó `extensions`, `private` y `public`: **sin errores de esquema**. Las migraciones locales y remotas están alineadas de `100` a `119`.

## Auditoría

- 1.170 eventos en la Sheet y 1.170 en Supabase, sin diferencias.
- `legacy_id` y `source = LEGACY_SHEET` preservados.
- Cuando la entidad existe, `entity_id` contiene el UUID nuevo.
- Las 23 referencias históricas sin entidad actual mantienen `legacy_entity_id` y `entity_id = NULL`; no hay pérdida del evento.
- La importación no creó solicitudes, incidencias, seguimientos ni controles y no envió emails.

## Contraseñas y Auth

Algoritmo legacy confirmado:

```text
out = SHA256_HEX_UTF8(salt + "|" + String(password))
for i = 1; i < 1000; i++:
  out = SHA256_HEX_UTF8(salt + "|" + out)
```

No aplica trim, lowercase ni normalización a la contraseña. El formato es v2/1000 y no es compatible de forma nativa con bcrypt de Supabase Auth; el mecanismo elegido es migración JIT en el primer login.

Pruebas ejecutadas:

- vector de hash exacto: OK;
- primer login legacy y conversión automática: OK;
- logout: OK;
- segundo login nativo con la misma contraseña: OK;
- prueba sintética repetida sobre la función limpia: OK;
- cuenta TEST con credencial legacy real: OK;
- intentos fallidos finales: 0; bloqueo: ninguno;
- hash/salt retenidos: sí; purga: no;
- contraseña en logs o reportes: no.

Estado global del vault tras la prueba: 78 total contando TEST, 76 pendientes, 0 migradas sin validar, 2 validadas con credenciales retenidas, 0 purgadas y 0 bloqueadas.

El 401 anterior se produjo porque la contraseña introducida no coincidía con el hash legacy entonces importado. La búsqueda, el algoritmo v2/1000 y la función eran correctos. Tras importar de forma controlada el hash/salt actualizado desde la Sheet vigente, ambos logins pasan. No se hizo reset, no se envió email y no se eliminó ningún hash/salt.

## Verificaciones técnicas

- Reconciliación remota: 24/24 OK.
- Tests Node: 4/4 OK.
- Auditoría npm: 0 vulnerabilidades.
- `deno check` de `legacy-auth-migrate`: OK.
- Edge Function limpia desplegada con `verify_jwt = false` y CORS restringido por `ALLOWED_ORIGIN`.
- `supabase db lint --linked`: sin errores.
- pgTAP mediante CLI no se pudo relanzar porque Docker Desktop no está activo; la prueba RLS equivalente ya está incorporada y ejecutada por la migración transaccional 117.

## Conclusión

La fase de migración de datos y la validación técnica del mecanismo JIT quedan **cerradas en staging**. No se ha realizado ningún cambio de producción. El frontend aún debe integrar la Edge Function JIT y completar módulos funcionales antes de considerar un corte; ese estado se detalla en `MIGRATION_STATUS.md`.
