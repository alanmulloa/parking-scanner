import { assert, countRows, rows, section, service } from './_common.mjs';

section('SNAPSHOT REAL - SOLO LECTURA');

const nonRootProfiles = await countRows('profiles', (q) => q.eq('is_root', false));
const rootProfiles = await countRows('profiles', (q) => q.eq('is_root', true));
const members = await countRows('community_members');
const dwellingsCount = await countRows('dwellings');
const vehiclesCount = await countRows('vehicles');
const legacyAudit = await countRows('audit_log', (q) => q.eq('source', 'LEGACY_SHEET'));
const totalAudit = await countRows('audit_log');

console.log({ nonRootProfiles, rootProfiles, members, dwellingsCount, vehiclesCount, legacyAudit, totalAudit });
assert(nonRootProfiles === 77, '77 perfiles normales migrados', `actual=${nonRootProfiles}`);
assert(rootProfiles === 1, 'Existe exactamente 1 ROOT técnico', `actual=${rootProfiles}`);
assert(members === 77, '77 memberships normales', `actual=${members}`);
assert(dwellingsCount === 77, '77 viviendas reales', `actual=${dwellingsCount}`);
assert(vehiclesCount === 35, '35 vehículos reales', `actual=${vehiclesCount}`);
assert(legacyAudit === 1173, '1.173 auditorías legacy preservadas', `actual=${legacyAudit}`);
assert(totalAudit >= legacyAudit, 'Auditoría técnica/aplicación no reduce el histórico');

section('ROOT AISLADO');
const roots = await rows('profiles', 'user_id,email,is_root,state', (q) => q.eq('is_root', true));
const rootIds = roots.map((r) => r.user_id);
let rootMemberships = 0;
if (rootIds.length) rootMemberships = await countRows('community_members', (q) => q.in('user_id', rootIds));
assert(rootMemberships === 0, 'ROOT no pertenece a community_members', `actual=${rootMemberships}`);

section('INTEGRIDAD VEHICULOS');
const dwellings = await rows('dwellings', 'id,community_id,state,responsible_user_id,legacy_id,display_name');
const dwellingMap = new Map(dwellings.map((d) => [d.id, d]));
const vehicles = await rows('vehicles', 'id,community_id,dwelling_id,legacy_id,habitual_plate,normalized_habitual_plate,type,state,slot,qr_token,qr_state');

const plateSeen = new Map();
const slotSeen = new Map();
const problems = [];
for (const v of vehicles) {
  const d = dwellingMap.get(v.dwelling_id);
  if (!d) problems.push(`vehículo ${v.habitual_plate}: vivienda inexistente`);
  else if (d.community_id !== v.community_id) problems.push(`vehículo ${v.habitual_plate}: comunidad distinta a vivienda`);

  const plate = v.normalized_habitual_plate || '';
  if (plate) {
    const key = `${v.community_id}:${plate}`;
    if (plateSeen.has(key)) problems.push(`matrícula duplicada ${plate}`);
    plateSeen.set(key, v.id);
  }
  if (v.slot != null) {
    const key = `${v.dwelling_id}:${v.slot}`;
    if (slotSeen.has(key)) problems.push(`slot duplicado ${key}`);
    slotSeen.set(key, v.id);
  }

  if (v.type === 'Moto' && (v.slot != null || v.qr_token != null || v.qr_state != null)) {
    problems.push(`moto ${v.habitual_plate} con slot/QR`);
  }
  if (['Desasignado', 'Suspendido', 'Baja'].includes(v.state) && (v.slot != null || v.qr_token != null || v.qr_state != null)) {
    problems.push(`${v.habitual_plate} ${v.state} conserva slot/QR`);
  }
  if (v.state === 'Activo' && v.type !== 'Moto' && v.slot != null && (!v.qr_token || !['Activo', 'Revocado'].includes(v.qr_state))) {
    problems.push(`${v.habitual_plate} activo con slot pero QR inválido`);
  }
  if (v.state === 'Activo' && v.type !== 'Moto' && v.slot == null && (v.qr_token != null || v.qr_state != null)) {
    problems.push(`${v.habitual_plate} activo sin slot pero con QR`);
  }
}
assert(problems.length === 0, 'Vehículos sin inconsistencias estructurales', problems.join('\n  '));

section('TEMPORALES');
const temporaries = await rows('temporary_periods', 'id,community_id,vehicle_id,temporary_plate,normalized_temporary_plate,starts_at,ends_at,state');
const activeVehicleIds = new Set(vehicles.filter((v) => v.state === 'Activo').map((v) => v.id));
const today = new Date().toISOString().slice(0, 10);
const tempProblems = [];
for (const t of temporaries) {
  if (t.ends_at < t.starts_at) tempProblems.push(`${t.temporary_plate}: fin anterior al inicio`);
  if (t.state !== 'Anulado' && t.starts_at <= today && today <= t.ends_at && !activeVehicleIds.has(t.vehicle_id)) {
    tempProblems.push(`${t.temporary_plate}: vigente sobre vehículo no activo`);
  }
}
for (let i = 0; i < temporaries.length; i += 1) {
  const a = temporaries[i];
  if (a.state === 'Anulado') continue;
  for (let j = i + 1; j < temporaries.length; j += 1) {
    const b = temporaries[j];
    if (b.state === 'Anulado') continue;
    if (a.community_id !== b.community_id || a.normalized_temporary_plate !== b.normalized_temporary_plate) continue;
    if (a.starts_at <= b.ends_at && b.starts_at <= a.ends_at) {
      tempProblems.push(`${a.temporary_plate}: períodos solapados ${a.id}/${b.id}`);
    }
  }
}
assert(tempProblems.length === 0, 'Temporales sin inconsistencias', tempProblems.join('\n  '));

section('RELACIONES');
const requests = await rows('requests', 'id,dwelling_id,vehicle_id,community_id');
const incidents = await rows('incidents', 'id,dwelling_id,vehicle_id,related_dwelling_id,related_vehicle_id,community_id');
const vehicleIds = new Set(vehicles.map((v) => v.id));
const dwellingIds = new Set(dwellings.map((d) => d.id));
const relProblems = [];
for (const r of requests) {
  if (!dwellingIds.has(r.dwelling_id)) relProblems.push(`solicitud ${r.id}: vivienda rota`);
  if (r.vehicle_id && !vehicleIds.has(r.vehicle_id)) relProblems.push(`solicitud ${r.id}: vehículo roto`);
}
for (const i of incidents) {
  if (i.dwelling_id && !dwellingIds.has(i.dwelling_id)) relProblems.push(`incidencia ${i.id}: vivienda rota`);
  if (i.vehicle_id && !vehicleIds.has(i.vehicle_id)) relProblems.push(`incidencia ${i.id}: vehículo roto`);
  if (i.related_dwelling_id && !dwellingIds.has(i.related_dwelling_id)) relProblems.push(`incidencia ${i.id}: vivienda relacionada rota`);
  if (i.related_vehicle_id && !vehicleIds.has(i.related_vehicle_id)) relProblems.push(`incidencia ${i.id}: vehículo relacionado roto`);
}
assert(relProblems.length === 0, 'Relaciones de solicitudes/incidencias íntegras', relProblems.join('\n  '));

section('RESIDUOS DE TEST');
const testDw = await countRows('dwellings', (q) => q.ilike('legacy_id', 'PREPROD_TEST_%'));
const testVeh = await countRows('vehicles', (q) => q.ilike('legacy_id', 'PREPROD_TEST_%'));
const testProfiles = await countRows('profiles', (q) => q.ilike('email', 'preprod-test+%@example.invalid'));
assert(testDw === 0 && testVeh === 0 && testProfiles === 0, 'No hay fixtures TEST residuales', `dwellings=${testDw}, vehicles=${testVeh}, profiles=${testProfiles}`);

console.log('\nPREPRODUCTION READ-ONLY: OK');
