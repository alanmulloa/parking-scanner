# Edge Functions

`legacy-auth-migrate` implementa la conversión transparente de la contraseña legacy en el primer login. Primero intenta Supabase Auth; solo si falla consulta la credencial temporal mediante RPC de `service_role`, reproduce el SHA-256 iterado del Apps Script y establece la misma contraseña en Auth. Tras la conversión conserva temporalmente hash y salt. El segundo login Supabase marca la credencial como validada y la purga se realiza posteriormente de forma explícita.

La función está desplegada y validada únicamente en el entorno de prueba `tefnzjvylcvffnorgzls`. `ALLOWED_ORIGIN` está configurado como secreto. Cualquier nuevo despliegue debe seguir `docs/AUTH_JIT_MIGRATION.md` y repetir `deno check`, la prueba sintética y el segundo login nativo.

Nunca guardar `service_role` en GitHub Pages ni en archivos versionados del frontend.
