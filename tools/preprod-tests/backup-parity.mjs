import fs from 'node:fs';

const admin = fs.readFileSync(
  'supabase/functions/parking-admin/index.ts',
  'utf8'
);

const checks = [
  [
    'backupExport existe',
    admin.includes("action === 'backupExport'")
  ],
  [
    'backup ROOT-only',
    admin.includes("action === 'backupExport'") &&
    admin.includes("if (!actorProfile.data?.is_root)")
  ],
  [
    'exporta perfiles',
    admin.includes("'profiles'")
  ],
  [
    'exporta viviendas',
    admin.includes("'dwellings'")
  ],
  [
    'exporta vehículos',
    admin.includes("'vehicles'")
  ],
  [
    'exporta QR',
    admin.includes("'qr_controls'")
  ],
  [
    'exporta temporales',
    admin.includes("'temporary_periods'")
  ],
  [
    'exporta solicitudes',
    admin.includes("'requests'")
  ],
  [
    'exporta incidencias',
    admin.includes("'incidents'")
  ],
  [
    'exporta seguimientos',
    admin.includes("'incident_followups'")
  ],
  [
    'exporta auditoría',
    admin.includes("'audit_log'")
  ],
  [
    'incluye conteos',
    admin.includes('counts[table]')
  ],
  [
    'incluye fecha de generación',
    admin.includes('generatedAt')
  ]
];

let ok = true;

for (const [label, result] of checks) {
  console.log(result ? 'OK  ' : 'FAIL', label);
  if (!result) ok = false;
}

if (!ok) process.exit(1);

console.log('Backup parity static tests: OK');
