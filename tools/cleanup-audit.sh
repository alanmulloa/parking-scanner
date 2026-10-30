#!/bin/sh
set -eu

OUT="reports/cleanup/post-migration-audit.txt"

{
  echo "============================================================"
  echo "PARKING COMUNIDAD - POST MIGRATION TECHNICAL DEBT AUDIT"
  echo "============================================================"
  echo
  echo "Fecha: $(date)"
  echo "Rama: $(git branch --show-current)"
  echo "Commit: $(git rev-parse --short HEAD)"
  echo

  echo "============================================================"
  echo "1. ESTRUCTURA PRINCIPAL"
  echo "============================================================"
  find assets supabase legacy-apps-script tools docs scanner \
    -type f 2>/dev/null \
    | sort
  echo

  echo "============================================================"
  echo "2. ARCHIVOS JS/CSS VERSIONADOS O HISTORICOS"
  echo "============================================================"
  find assets \
    -type f \
    \( -name '*FIX*' -o -name '*preprod*' -o -name '*1.2.*' -o -name '*.old' -o -name '*.bak' \) \
    2>/dev/null \
    | sort
  echo

  echo "============================================================"
  echo "3. REFERENCIAS LEGACY GENERALES"
  echo "============================================================"
  git grep -nEi \
    'legacy|Apps Script|Google Apps Script|LEGACY_SHEET|migration_pending|created_from|bridge' \
    -- \
    ':!reports' \
    ':!node_modules' \
    || true
  echo

  echo "============================================================"
  echo "4. CORREO LEGACY"
  echo "============================================================"
  git grep -nEi \
    'mail:|mail bridge|worker correo|testWelcome|sendTemporaryPassword|sendAccess|emailStatus|retryFailed|setNoReply|senderMode|parkingBridgeSend' \
    -- \
    ':!reports' \
    ':!node_modules' \
    || true
  echo

  echo "============================================================"
  echo "5. LEGACY AUTH / MIGRACION"
  echo "============================================================"
  git grep -nEi \
    'legacy-auth-migrate|migration_pending|legacy_password|password_delivery|created_from' \
    -- \
    ':!reports' \
    ':!node_modules' \
    || true
  echo

  echo "============================================================"
  echo "6. BRIDGE DRIVE / DOCS"
  echo "============================================================"
  git grep -nEi \
    'Google Drive|Google Docs|documents:|configureFolder|verifyDrive|driveStatus|testDocs|generateMissing|regenerateAll' \
    -- \
    ':!reports' \
    ':!node_modules' \
    || true
  echo

  echo "============================================================"
  echo "7. APP SCRIPT"
  echo "============================================================"
  find legacy-apps-script -type f -maxdepth 2 -print 2>/dev/null | sort
  echo

  if [ -d legacy-apps-script ]; then
    echo "--- Funciones Apps Script ---"
    grep -RnhE '^(async[[:space:]]+)?function[[:space:]]+[A-Za-z0-9_]+' \
      legacy-apps-script 2>/dev/null \
      || true
  fi
  echo

  echo "============================================================"
  echo "8. EDGE FUNCTIONS"
  echo "============================================================"
  find supabase/functions -maxdepth 2 -type f 2>/dev/null | sort
  echo

  echo "--- Referencias desde frontend/backend ---"
  find supabase/functions -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
    | while read -r dir; do
        name=$(basename "$dir")
        count=$(git grep -l "$name" -- ':!supabase/functions/*' ':!reports' 2>/dev/null | wc -l | tr -d ' ')
        printf "%-35s referencias_fuera_funcion=%s\n" "$name" "$count"
      done
  echo

  echo "============================================================"
  echo "9. RPC / FUNCIONES SQL REFERENCIADAS EN JS"
  echo "============================================================"
  git grep -hoE "\.rpc\('[A-Za-z0-9_]+'" -- '*.js' '*.mjs' 2>/dev/null \
    | sed "s/.*\.rpc('//;s/'$//" \
    | sort -u \
    || true
  echo

  echo "============================================================"
  echo "10. BUNDLES / CSS REALMENTE CARGADOS"
  echo "============================================================"
  grep -nE '<script|stylesheet' index.html preproduccion.html 2>/dev/null || true
  echo

  echo "============================================================"
  echo "11. POSIBLES ARCHIVOS JS SIN REFERENCIAS POR NOMBRE"
  echo "============================================================"
  find assets/js -type f -name '*.js' \
    ! -name 'app.bundle.js' \
    | while read -r file; do
        base=$(basename "$file")
        refs=$(git grep -l "$base" -- '*.html' '*.js' '*.mjs' ':!'"$file" 2>/dev/null | wc -l | tr -d ' ')
        if [ "$refs" = "0" ]; then
          echo "$file"
        fi
      done
  echo

  echo "============================================================"
  echo "12. POSIBLES CSS SIN REFERENCIAS POR NOMBRE"
  echo "============================================================"
  find assets/css -type f -name '*.css' \
    | while read -r file; do
        base=$(basename "$file")
        refs=$(git grep -l "$base" -- '*.html' '*.js' '*.mjs' ':!'"$file" 2>/dev/null | wc -l | tr -d ' ')
        if [ "$refs" = "0" ]; then
          echo "$file"
        fi
      done
  echo

  echo "============================================================"
  echo "13. TODO / FIXME / TEMP / DEPRECATED"
  echo "============================================================"
  git grep -nEi \
    'TODO|FIXME|TEMPORARY|TEMPORAL|DEPRECATED|OBSOLETE|REMOVE AFTER|BORRAR|ELIMINAR DESPUES' \
    -- \
    ':!reports' \
    ':!node_modules' \
    || true
  echo

  echo "============================================================"
  echo "14. ESTADO GIT"
  echo "============================================================"
  git status --short
  echo
  git log --oneline --decorate -15

} > "$OUT"

echo "OK: $OUT"
