import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const core = read('assets/js/core.js');
const nav = read('assets/js/auth-navigation.js');
const advanced = read('assets/js/admin/advanced.js');
const adapter = read('assets/js/supabase-final-adapter.js');
const scanner = read('scanner/scanner.js');
const migration = read('supabase/migrations/20261029012800_system_v2_maintenance.sql');
const statusFix = read('supabase/migrations/20261029012900_system_v2_status_corrections.sql');
const parkingAdmin = read('supabase/functions/parking-admin/index.ts');
const preprod = read('preproduccion.html');

const checks = [
  ['frontend version preprod v2', core.includes("APP_FRONTEND_VERSION='2.0.0-preprod.3'")],
  ['favicon dinamico', core.includes("dataset.parkingFavicon='1'") && core.includes("apple-touch-icon")],
  ['pantalla mantenimiento', core.includes('renderMaintenanceScreen') && core.includes('Acceso técnico ROOT')],
  ['init consulta estado publico', nav.includes("server('getPublicAppState')")],
  ['Sistema ya no muestra Hojas', !advanced.includes('<span>Hojas</span>')],
  ['Sistema ya no ofrece Benchmark Sheets', !advanced.includes('Benchmark Sheets')],
  ['Sistema muestra correo heredado', advanced.includes("integrationCard('Correo'") && advanced.includes('Worker correo')],
  ['Sistema muestra Drive/Docs heredado', advanced.includes("integrationCard('Google Drive / Docs'") && advanced.includes("['generateMissing','Generar faltantes']")],
  ['Sistema tiene mantenimiento ROOT', advanced.includes("call('systemSetMaintenance'")],
  ['Sistema tiene consistencia', advanced.includes("call('consistencyReport'")],
  ['status usa mediciones reales', adapter.includes("timed('Base de datos'") && adapter.includes("parkingAdmin('systemPing'")],
  ['status backend 129', adapter.includes("Supabase migration 129")],
  ['estado publico maintenance RPC', migration.includes('public.parking_public_state()')],
  ['set mantenimiento ROOT-only', migration.includes('public.parking_set_maintenance') && migration.includes("Acceso exclusivo ROOT")],
  ['snapshot sistema 129', statusFix.includes("'schemaVersion', '20261029012900'")],
  ['auditoria legacy usa LEGACY_SHEET', statusFix.includes("source='LEGACY_SHEET'")],
  ['hora Sistema usa Europe/Madrid', advanced.includes("timeZone:'Europe/Madrid'")],
  ['parking-admin ping ROOT', parkingAdmin.includes("action === 'systemPing'") && parkingAdmin.includes('actorProfile.data.is_root')],
  ['scanner consulta mantenimiento', scanner.includes('/rest/v1/rpc/parking_public_state')],
  ['scanner sin URL personal antigua', !scanner.includes('alanmulloa.github.io/parking-scanner')],
  ['preprod usa bundle/css actuales', preprod.includes('app.bundle.js?v=system-v2') && preprod.includes('app.css?v=system-v2')]
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
console.log('System v2 parity static tests: OK');
