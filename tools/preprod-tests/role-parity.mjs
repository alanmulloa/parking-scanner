import fs from 'node:fs';
const adapter = fs.readFileSync(new URL('../../assets/js/supabase-final-adapter.js', import.meta.url), 'utf8');
const checks = [
  ['globalSearch calcula canAdmin', adapter.includes('const canAdmin = boot.user.IsRoot || boot.roles.includes(\'ADMIN\')')],
  ['viviendas solo se buscan para admin/root', adapter.includes('canAdmin ? listHousing() : Promise.resolve([])')],
  ['solicitudes solo se buscan para admin/root', adapter.includes('canAdmin ? listRequests() : Promise.resolve([])')],
  ['housingDetail tiene guard admin/root', adapter.includes('No tienes permisos para consultar el detalle de viviendas.')],
  ['vehicleHistory tiene guard admin/root', adapter.includes('No tienes permisos para consultar el historial completo del vehículo.')],
  ['CanSystem solo ROOT', adapter.includes('CanSystem: !!profile.is_root')],
  ['CanConfigure ROOT o ADMIN', adapter.includes("CanConfigure: !!profile.is_root || roles.includes('ADMIN')")],
  ['ownerBundle filtra viviendas por responsable', adapter.includes(".eq('responsible_user_id', ownerUserId)")],
  ['ownerBundle filtra vehiculos por viviendas propias', adapter.includes(".in('dwelling_id', housingIds)")],
  ['ROOT resuelve propietario normal por email visible', adapter.includes(".eq('is_root', false)") && adapter.includes(".ilike('email', visibleEmail)")]
];
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);

console.log('Role parity static tests: OK');
