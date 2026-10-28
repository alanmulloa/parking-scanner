# Migración transparente de contraseñas

## Por qué se usa JIT

El sistema legacy almacena un SHA-256 iterado propio; Supabase Auth almacena contraseñas con bcrypt. El parámetro administrativo `password_hash` no convierte un hash arbitrario en bcrypt verificable. Referencias: [seguridad de contraseñas de Supabase](https://supabase.com/docs/guides/auth/password-security), [Admin createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser) y [comparación de contraseña en Supabase Auth](https://github.com/supabase/auth/blob/master/internal/crypto/password.go).

## Algoritmo reproducido

Fuente legacy: `Data.gs::hash`, `Auth.gs::passwordHash`, `Auth.gs::verifyPassword` y `Config.gs`.

```text
out = SHA256_HEX_UTF8(salt + "|" + String(password))
for i = 1; i < rounds; i++:
  out = SHA256_HEX_UTF8(salt + "|" + out)
```

El libro contiene exclusivamente `v2`, 1.000 iteraciones. No se recorta ni normaliza la contraseña. El vector sintético `Parking123` + `SALT_TEST` produce `db47a61020f7048cf20cb6f72ba4e0bc68d848fc0eec5465496df9a85ec248ec` y está cubierto por test.

## Primer login

1. El importador crea `auth.users` confirmado con contraseña aleatoria desconocida y sin enviar email.
2. `legacy-auth-migrate` intenta primero `signInWithPassword` normal.
3. Si falla, una llamada de backend `service_role` obtiene la credencial privada no migrada.
4. Verifica localmente el SHA-256 iterado con comparación constante.
5. Si coincide, `admin.updateUserById` establece exactamente la contraseña introducida.
6. Comprueba inmediatamente un login Supabase normal.
7. Marca la credencial migrada y conserva hash y salt hasta validar explícitamente primer y segundo login.
8. Devuelve la sesión. El segundo login ya entra directamente por Supabase Auth.

Los fallos son genéricos para no enumerar emails. Cinco fallos bloquean el JIT durante 15 minutos. La función restringe CORS a `ALLOWED_ORIGIN` y no registra secretos. Está desplegada en la POC, pero el frontend todavía no la utiliza.

## Despliegue de prueba

```bash
supabase secrets set ALLOWED_ORIGIN=https://staging.example SUPABASE_SERVICE_ROLE_KEY=... --project-ref tefnzjvylcvffnorgzls
supabase functions deploy legacy-auth-migrate --project-ref tefnzjvylcvffnorgzls --no-verify-jwt
```

No versionar ni exponer `SUPABASE_SERVICE_ROLE_KEY`.

## Validación cerrada en staging

Con una cuenta autorizada por su titular:

1. ejecutar primer login con contraseña actual;
2. verificar `migrated: true`;
3. cerrar sesión;
4. repetir el login;
5. verificar `migrated: false` y sesión válida;
6. comprobar `migrated_at`, `validated_at`, cero intentos fallidos y ausencia de bloqueo;
7. confirmar que hash/salt permanecen retenidos y que no se ejecutó ninguna purga;
8. no copiar la contraseña a comandos, logs ni informes.

El recorrido quedó validado el 2026-10-28 tanto con una cuenta sintética como con la cuenta TEST que conserva una credencial legacy real. La contraseña se introdujo en un cuadro oculto de macOS, se mantuvo únicamente en memoria y no apareció en comandos, salida ni logs.

Resultado TEST:

- coincidencia local con el hash legacy: OK;
- primer login y conversión JIT: OK;
- logout local: OK;
- segundo login nativo con la misma contraseña: OK;
- `migrated = true`, `validated = true`: OK;
- `credentials_retained = true`, `purged = false`: OK;
- `failed_attempts = 0`, `locked_until = NULL`: OK.

La causa del HTTP 401 anterior fue una no coincidencia entre la contraseña introducida y la credencial legacy entonces importada. La consulta de usuario, el algoritmo v2/1000 y el tipo de `iterations` eran correctos. Tras llevar el hash/salt actualizado desde la Sheet (checksum `a365ec50fa366a25ebbff0597ebbc257f8717eedc7cfeadb90cfba01fe99fecb`), la comparación y ambos logins pasan. No se cambió el algoritmo ni se hizo reset de contraseña.

La instrumentación diagnóstica temporal se retiró antes del despliegue final. La función limpia volvió a superar `deno check` y el recorrido sintético completo.

## Estado de retención

No se ha purgado ninguna credencial. El estado global tras la prueba es: 78 filas en el vault contando la cuenta TEST, 76 pendientes, 0 migradas sin validar, 2 validadas con credencial retenida, 0 purgadas y 0 bloqueadas. La purga futura es una operación explícita y queda fuera de esta fase.

## Integración pendiente en frontend

La Edge Function está desplegada y validada, pero `supabase-poc-adapter.js` aún llama directamente a `signInWithPassword`. Antes de cualquier corte, `loginWithPassword` debe invocar `legacy-auth-migrate` y consumir la sesión devuelta; después se debe repetir el test funcional desde la interfaz.
