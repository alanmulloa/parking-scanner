# Perfil de `DDBB QR Comunidad.xlsx`

Fuente analizada en modo solo lectura. SHA-256 vigente: `a365ec50fa366a25ebbff0597ebbc257f8717eedc7cfeadb90cfba01fe99fecb`.

| Pestaña | Filas | Destino |
|---|---:|---|
| Usuarios | 77 | `auth.users`, `profiles`, `community_members`, bóveda JIT |
| Viviendas | 77 | `dwellings` |
| Vehiculos | 35 | `vehicles` |
| PeriodosTemporales | 0 | `temporary_periods` |
| Solicitudes | 0 | `requests` |
| Incidencias | 0 | `incidents` |
| IncidenciaSeguimiento | 0 | `incident_followups` |
| Auditoria | 1.170 | `audit_log` |
| ControlQR | 0 | `qr_controls` |
| ControlMatricula | 0 | `plate_controls` |
| Configuracion | 8 | `community_settings` y atributos básicos de `communities` |

## Hallazgos

- 77 emails únicos; ningún usuario, vivienda, vehículo o evento de auditoría tiene ID legacy duplicado.
- Roles: 1 ADMIN, 68 PROPIETARIO y 8 CONTROL+PROPIETARIO. En el modelo resultan 1 ADMIN, 8 CONTROL y 76 PROPIETARIO.
- Los 77 responsables de vivienda resuelven a un email de usuario.
- Los 35 vehículos resuelven a vivienda. Hay 30 particulares, 4 motos y 1 empresa.
- Slots: 20 en Slot 1, 11 en Slot 2 y las 4 motos sin slot. No hay conflictos.
- 31 vehículos tienen QR; no hay tokens ni matrículas habituales duplicados.
- Las columnas temporales de `Vehiculos` están vacías y `PeriodosTemporales` no tiene filas.
- La auditoría contiene 464 eventos de USUARIOS, 385 de VIVIENDAS y 315 de VEHICULOS.
- 23 referencias históricas de auditoría ya no tienen entidad actual resoluble. Se conservan en `legacy_entity_id`; `entity_id` queda `NULL`.
- No hay fórmulas en el libro.
- `Telefono` está vacío en los 77 usuarios. Se importa como cadena vacía para mantener compatibilidad del perfil.
- Dos valores de Configuracion están vacíos. Se preservan como cadenas JSON vacías, sin inventar contenido.

## Credenciales

Los 77 hashes tienen formato `v2$1000$<64 hex>` y los 77 salts están presentes. El informe nunca incluye hashes, salts, emails ni contraseñas. El algoritmo comprobado en el código estable es:

1. `SHA256_HEX(salt + "|" + password)`;
2. repetir 999 veces `SHA256_HEX(salt + "|" + hash_anterior)`;
3. UTF-8, hexadecimal minúscula, sin trim ni cambio de mayúsculas de la contraseña.

Supabase Auth usa bcrypt, por lo que estos hashes no son importables como bcrypt válido. La decisión es migración JIT transparente.

## Transformaciones conservadoras

- `Viviendas.Estado = Activa` se normaliza a `Activo`, valor ya usado por el esquema común.
- Los IDs legacy permanecen como texto y todas las relaciones funcionales nuevas usan UUID.
- `Responsable`, `Usuario`, `UsuarioAlta` y equivalentes se resuelven por email a UUID.
- Las matrículas normalizadas se calculan en PostgreSQL, no en el navegador.
- Los roles separados por coma se convierten en un array controlado por comunidad. ROOT sigue siendo global en `profiles.is_root`.
- Los campos históricos de solicitudes e incidencias permanecen como snapshots, no se recalculan.
- Las fotos/documentos legacy se preservan como referencia hasta copiarlos al bucket privado; en este libro no hay filas que requieran copia.

No se descartó ningún dato poblado. Los únicos valores sin UUID resoluble son las 23 referencias históricas descritas arriba.
