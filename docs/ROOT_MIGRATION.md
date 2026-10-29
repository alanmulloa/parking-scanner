# ROOT técnico en Supabase

## Contrato heredado

La versión estable permite utilizar el mismo email visible con dos credenciales distintas:

- contraseña técnica → sesión ROOT;
- contraseña funcional normal → usuario normal.

La comprobación ROOT ocurre primero y, si no coincide, continúa el login normal.

## Diseño Supabase

Supabase Auth no admite dos usuarios con el mismo email. Por eso:

- ROOT tiene un email Auth interno no mostrado al usuario;
- `private.technical_root_accounts` mapea email técnico visible → usuario Auth interno;
- un verificador PBKDF2-SHA256 privado permite saber si la contraseña introducida es la técnica sin provocar un intento Auth fallido sobre ROOT;
- si el verificador coincide, se autentica la identidad Auth interna con esa misma contraseña;
- si no coincide, se intenta el login normal con el email visible;
- el frontend y la auditoría muestran siempre el email técnico visible, nunca el interno.

No se guarda la contraseña en texto plano.

## Aprovisionamiento

Aplicar primero la migración 127 y después:

```bash
cd tools/sheet-import
read "ROOT_LOGIN_EMAIL?Email técnico ROOT: "
read -s "ROOT_PASSWORD?Contraseña ROOT actual: "
echo
export ROOT_LOGIN_EMAIL ROOT_PASSWORD
export ROOT_DISPLAY_NAME="Administrador"
node --env-file=.env ./root-provision.mjs
unset ROOT_PASSWORD ROOT_LOGIN_EMAIL ROOT_DISPLAY_NAME
```

El script usa `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` desde `.env` local.

Nunca copiar ROOT password al repo, documentación, logs ni frontend.

## Tests obligatorios

- contraseña técnica correcta → ROOT;
- contraseña técnica incorrecta + contraseña normal correcta del mismo email → usuario normal;
- contraseña incorrecta para ambos → 401;
- ROOT no aparece en listado normal;
- ROOT no tiene `community_members`;
- ADMIN no puede cambiar ROOT;
- perfil ROOT no puede cambiar contraseña técnica por el flujo normal;
- audit ROOT usa email técnico visible;
- ROOT ve Sistema; ADMIN no.
