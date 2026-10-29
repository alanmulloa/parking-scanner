# Despliegue de preproducción Supabase

Este runbook NO modifica producción Apps Script.

## 1. Comprobar branch/worktree

Trabajar sobre `supabase-poc`. No usar `main`.

## 2. Confirmar migraciones remotas

```bash
npx supabase migration list --project-ref tefnzjvylcvffnorgzls
```

Verificar qué versiones hasta 122 ya están en remoto antes de aplicar nada.

## 3. Aplicar migraciones pendientes

Desde el repo con Supabase CLI enlazado:

```bash
npx supabase db push --project-ref tefnzjvylcvffnorgzls
```

Confirmar que quedan aplicadas, en orden, las migraciones 123–127.

No editar migraciones que ya hayan llegado a remoto.

## 4. Edge Functions

```bash
npx supabase functions deploy legacy-auth-migrate \
  --project-ref tefnzjvylcvffnorgzls \
  --no-verify-jwt

npx supabase functions deploy parking-admin \
  --project-ref tefnzjvylcvffnorgzls \
  --no-verify-jwt
```

Configurar `ALLOWED_ORIGIN` con el origen exacto de preproducción.

## 5. ROOT

Seguir `docs/ROOT_MIGRATION.md` y aprovisionar con la contraseña técnica actual.

No usar la gestión normal de usuarios para ROOT.

## 6. Publicar frontend staging

Publicar `preproduccion.html` y los assets asociados en una URL distinta de producción.

No modificar `index.html` productivo de Apps Script ni TinyURL.

## 7. Smoke tests iniciales

En orden:

1. usuario normal ya migrado;
2. usuario pendiente JIT sintético/controlado;
3. ROOT técnico;
4. ADMIN;
5. CONTROL;
6. PROPIETARIO;
7. QR `?q=`;
8. matrícula;
9. incidencia;
10. solicitud;
11. auditoría.

## 8. Matriz completa

Ejecutar `docs/PREPRODUCTION_TEST_PLAN.md`.

## 9. No hacer todavía

- no redirigir Apps Script;
- no cambiar TinyURL;
- no borrar Sheet;
- no purgar credenciales legacy;
- no importar un XLSX posterior una vez que usuarios empiecen a escribir en Supabase, salvo proceso de reconciliación controlada.
