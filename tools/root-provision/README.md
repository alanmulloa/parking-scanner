# Aprovisionamiento seguro del ROOT tecnico

El ROOT se guarda en Supabase Auth con un email interno y se mapea al email tecnico visible mediante `private.technical_root_accounts`.
Esto permite conservar el comportamiento estable: el mismo email visible puede iniciar sesion como ROOT con la contrasena tecnica o como usuario funcional con su contrasena normal.

## Requisitos

1. Tener aplicadas las migraciones hasta `20261029012700_technical_root_login.sql`.
2. Tener configurado `tools/sheet-import/.env` con `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.
3. Ejecutar el script desde `tools/sheet-import`, donde ya vive la dependencia `@supabase/supabase-js`.

## Ejecucion

```bash
cd tools/sheet-import
read "ROOT_LOGIN_EMAIL?Email tecnico ROOT: "
read -s "ROOT_PASSWORD?Contrasena ROOT actual: "
echo
export ROOT_LOGIN_EMAIL ROOT_PASSWORD
export ROOT_DISPLAY_NAME="Administrador"
node --env-file=.env ./root-provision.mjs
unset ROOT_PASSWORD ROOT_LOGIN_EMAIL ROOT_DISPLAY_NAME
```

La contrasena no se imprime ni se almacena en el repositorio. El script crea o actualiza la identidad ROOT interna, la marca `is_root=true`, elimina cualquier `community_members` accidental y registra el email visible mediante RPC backend.

No usar este procedimiento para usuarios normales.
