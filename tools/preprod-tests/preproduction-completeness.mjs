import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../../preproduccion.html');
const adapter = read('../../assets/js/supabase-final-adapter.js');
const admin = read('../../supabase/functions/parking-admin/index.ts');
const migration = read('../../supabase/migrations/20261029012300_preproduction_admin_completeness.sql');

const checks = [
  ['preproducción carga POC adapter', html.includes('supabase-poc-adapter.js')],
  ['preproducción carga final adapter', html.includes('supabase-final-adapter.js')],
  ['final adapter se carga después del POC adapter', html.indexOf('supabase-final-adapter.js') > html.indexOf('supabase-poc-adapter.js')],
  ['owner import template implementado', adapter.includes("case 'ownerImportTemplate'")],
  ['owner import preview implementado', adapter.includes("case 'previewOwnerImport'") && admin.includes("action === 'previewOwnerImport'")],
  ['owner import apply implementado', adapter.includes("case 'applyOwnerImport'") && admin.includes("action === 'applyOwnerImport'")],
  ['consistency report implementado', adapter.includes("case 'consistencyReport'") && migration.includes('parking_consistency_report')],
  ['consistency fix implementado', adapter.includes("case 'consistencyFix'") && migration.includes('parking_consistency_fix')],
  ['upload logo implementado', adapter.includes("case 'uploadLogo'") && adapter.includes("from('parking-public')")],
  ['bucket público controlado por RLS', migration.includes("'parking-public'") && migration.includes('parking_public_insert_admin')],
  ['producción no carga adaptador final', !read('../../index.html').includes('supabase-final-adapter.js')],
  ['service role no aparece en frontend final', !adapter.includes('SUPABASE_SERVICE_ROLE_KEY')],
  ['ROOT no se crea como membership normal desde owner import', !admin.includes("roles: ['ROOT']")]
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
