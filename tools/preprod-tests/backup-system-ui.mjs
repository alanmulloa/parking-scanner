import fs from 'node:fs';

const adapter = fs.readFileSync(
  'assets/js/supabase-final-adapter.js',
  'utf8'
);

const advanced = fs.readFileSync(
  'assets/js/admin/advanced.js',
  'utf8'
);

const admin = fs.readFileSync(
  'supabase/functions/parking-admin/index.ts',
  'utf8'
);

const checks = [
  [
    'adapter expone estado backup',
    adapter.includes("case 'systemBackupStatus'") &&
    adapter.includes("parkingAdmin('legacyBackupStatus'")
  ],

  [
    'adapter expone ejecución manual',
    adapter.includes("case 'systemBackupRunNow'") &&
    adapter.includes("parkingAdmin('legacyBackupRunNow'")
  ],

  [
    'parking-admin estado ROOT-only',
    admin.includes("action === 'legacyBackupStatus'") &&
    admin.includes("'backup.status'")
  ],

  [
    'parking-admin ejecución ROOT-only',
    admin.includes("action === 'legacyBackupRunNow'") &&
    admin.includes("'backup.runNow'")
  ],

  [
    'Sistema muestra tarjeta Backup Supabase',
    advanced.includes('id="system-backup-card"') &&
    advanced.includes('Backup Supabase')
  ],

  [
    'Sistema consulta estado backup',
    advanced.includes("call('systemBackupStatus')")
  ],

  [
    'Sistema permite ejecutar backup',
    advanced.includes("call('systemBackupRunNow')")
  ],

  [
    'Sistema refresca backup al cargar',
    advanced.includes('refreshBackupStatus();')
  ],

  [
    'Sistema muestra último archivo',
    advanced.includes('Abrir último backup')
  ],

  [
    'Sistema muestra retención',
    advanced.includes('retentionDays')
  ]
];

let ok = true;

for (const [label, result] of checks) {
  console.log(
    result ? 'OK  ' : 'FAIL',
    label
  );

  if (!result) ok = false;
}

if (!ok) {
  process.exit(1);
}

console.log(
  'Backup System UI parity: OK'
);
