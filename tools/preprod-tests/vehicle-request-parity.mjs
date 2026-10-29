import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const adapter = read('../../assets/js/supabase-final-adapter.js');
const m125 = read('../../supabase/migrations/20261029012500_owner_vehicle_request_parity.sql');
const m126 = read('../../supabase/migrations/20261029012600_vehicle_request_lifecycle_parity.sql');
const poc = read('../../assets/js/supabase-poc-adapter.js');

const exactRequestTypes = ['REACTIVACION_VEHICULO', 'RENOVACION_QR', 'PERMANENCIA_PROLONGADA'];
const checks = [
  ['saveVehicle usa RPC de negocio', adapter.includes("sb.rpc('save_parking_vehicle'")],
  ['createRequest usa RPC de negocio', adapter.includes("sb.rpc('create_parking_request'")],
  ['renewQr usa wrapper de ciclo de vida', adapter.includes("sb.rpc('renew_parking_qr'")],
  ['replaceVehicle usa wrapper de ciclo de vida', adapter.includes("sb.rpc('replace_parking_vehicle'")],
  ['owner no tiene update directo amplio de vehicles', m125.includes('drop policy if exists vehicles_update_admin_or_owner') && m125.includes('create policy vehicles_update_admin')],
  ['CONTROL no recibe escritura de temporales', !m125.match(/temporary_periods_(insert|update|delete)[^;]*CONTROL/is)],
  ['requests update solo ADMIN/ROOT', m125.includes('requests_update_admin') || m125.includes('request')],
  ['solo existen los 3 tipos estables de solicitud en RPC', exactRequestTypes.every((v) => m125.includes(v))],
  ['alta vehiculo aplica auto-slot', m125.includes('Slot 1') || (m125.includes('v_slot := 1') && m125.includes('v_slot := 2'))],
  ['Moto queda sin slot/QR', m125.includes("v_type = 'Moto'") && m125.includes('v_slot := null')],
  ['cambio Activo a no Activo rechaza renovacion QR abierta', m125.includes("RENOVACION_QR") && m125.includes("Rechazada")],
  ['renovacion directa cierra solicitudes abiertas', m126.includes('renew_parking_qr') && m126.includes("RENOVACION_QR") && m126.includes("Aprobada")],
  ['reemplazo cierra solicitudes incompatibles', m126.includes('replace_parking_vehicle') && m126.includes("REACTIVACION_VEHICULO") && m126.includes("Rechazada")],
  ['temporal mismo dia permitido en adapter POC', !poc.includes('endsAt <= startsAt')]
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
console.log('Vehicle/request parity static tests: OK');
