#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { readLegacyWorkbook, plate, text } from './model.mjs';

const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const file = resolve(valueOf('--file', '/Users/macbookairm1/Downloads/DDBB QR Comunidad.xlsx'));
const reportPath = resolve(valueOf('--report', 'reports/final-validation.json'));
const liveRls = args.includes('--live-rls');
const sqlRlsValidated = Number(valueOf('--rls-sql-validated', '0'));
const jitSyntheticValidated = args.includes('--jit-synthetic-validated');
const jitRealValidated = args.includes('--jit-real-validated');
const identityAliasesPath = valueOf('--identity-aliases', null);

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let emailAliases = {};
if (identityAliasesPath) {
  const { readFile } = await import('node:fs/promises');
  emailAliases = JSON.parse(await readFile(resolve(identityAliasesPath), 'utf8'));
}
const model = await readLegacyWorkbook(file, {
  communitySlug: process.env.COMMUNITY_SLUG,
  communityLegacyId: process.env.COMMUNITY_LEGACY_ID,
  emailAliases
});

async function allRows(table, columns, filter = (query) => query) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const result = await filter(client.from(table).select(columns).range(start, start + 999));
    if (result.error) throw new Error(`${table}: ${result.error.message}`);
    rows.push(...result.data);
    if (result.data.length < 1000) return rows;
  }
}

async function authUsers() {
  const rows = [];
  for (let page = 1; ; page += 1) {
    const result = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw result.error;
    rows.push(...result.data.users);
    if (result.data.users.length < 1000) return rows;
  }
}

const duplicates = (values) => {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
};
const normalized = (value) => value == null || value === '' ? null : String(value);
const sameTime = (left, right) => left == null && right == null || (left != null && right != null && Date.parse(left) === Date.parse(right));
const sameSet = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
const check = (name, ok, details = {}) => ({ name, ok: Boolean(ok), ...details });

const communities = await allRows('communities', 'id,legacy_id,slug,name');
const community = communities.find((row) => row.slug === model.community.slug);
if (!community) throw new Error(`No existe la comunidad ${model.community.slug}`);
const communityId = community.id;

const [profiles, allMembers, dwellings, vehicles, periods, requests, incidents, followups, audits, qrControls, plateControls, settings, auth] = await Promise.all([
  allRows('profiles', 'user_id,legacy_id,email,name,phone,state,is_root,last_access_at'),
  allRows('community_members', 'community_id,user_id,roles,state'),
  allRows('dwellings', 'id,community_id,legacy_id,block,floor,apartment,display_name,responsible_user_id,state,observations,created_at'),
  allRows('vehicles', 'id,community_id,dwelling_id,legacy_id,slot,habitual_plate,normalized_habitual_plate,make,model,type,state,qr_token,qr_state,observations,created_at'),
  allRows('temporary_periods', 'id,community_id,vehicle_id,legacy_id,temporary_plate,starts_at,ends_at,state,created_by,observations,created_at'),
  allRows('requests', 'id,community_id,legacy_id'),
  allRows('incidents', 'id,community_id,legacy_id'),
  allRows('incident_followups', 'id,community_id,legacy_id,incident_id'),
  allRows('audit_log', 'id,community_id,legacy_id,occurred_at,user_id,actor_user_id,actor_email,action,entity,entity_id,legacy_entity_id,field,previous_value,new_value,observations,source'),
  allRows('qr_controls', 'id,community_id,legacy_id,user_id,vehicle_id'),
  allRows('plate_controls', 'id,community_id,legacy_id,user_id,vehicle_id'),
  allRows('community_settings', 'community_id,key,value'),
  authUsers()
]);
const authStatusResult = await client.rpc('legacy_auth_migration_status');
if (authStatusResult.error) throw authStatusResult.error;
const authMigrationStatus = authStatusResult.data?.[0] || null;

const targetMembers = allMembers.filter((row) => row.community_id === communityId);
const targetDwellings = dwellings.filter((row) => row.community_id === communityId);
const targetVehicles = vehicles.filter((row) => row.community_id === communityId);
const targetPeriods = periods.filter((row) => row.community_id === communityId);
const targetAudits = audits.filter((row) => row.community_id === communityId);
const profileByLegacy = new Map(profiles.filter((row) => row.legacy_id).map((row) => [row.legacy_id, row]));
const profileByEmail = new Map(profiles.map((row) => [row.email.toLowerCase(), row]));
const memberByUser = new Map(targetMembers.map((row) => [row.user_id, row]));
const dwellingByLegacy = new Map(targetDwellings.map((row) => [row.legacy_id, row]));
const dwellingById = new Map(targetDwellings.map((row) => [row.id, row]));
const vehicleByLegacy = new Map(targetVehicles.map((row) => [row.legacy_id, row]));
const vehicleById = new Map(targetVehicles.map((row) => [row.id, row]));
const auditByLegacy = new Map(targetAudits.map((row) => [row.legacy_id, row]));
const authByEmail = new Map(auth.filter((row) => row.email).map((row) => [row.email.toLowerCase(), row]));
const importedAuthCount = model.users.filter((row) => authByEmail.has(row.email)).length;
const importedLegacyUserIds = new Set(model.users.map((row) => row.legacy_id));
const importedProfiles = profiles.filter((row) => importedLegacyUserIds.has(row.legacy_id));
const importedProfileUserIds = new Set(importedProfiles.map((row) => row.user_id));
const importedMembers = targetMembers.filter((row) => importedProfileUserIds.has(row.user_id));

const userDiffs = [];
for (const expected of model.users) {
  const actual = profileByLegacy.get(expected.legacy_id);
  if (!actual) { userDiffs.push({ legacy_id: expected.legacy_id, issue: 'MISSING_PROFILE' }); continue; }
  const member = memberByUser.get(actual.user_id);
  const expectedRoles = expected.roles.filter((role) => role !== 'ROOT');
  const reasons = [];
  if (actual.email.toLowerCase() !== expected.email) reasons.push('EMAIL');
  if (actual.name !== expected.name) reasons.push('NAME');
  if (actual.state !== expected.state) reasons.push('STATE');
  if (!member) reasons.push('MEMBERSHIP');
  else if (!sameSet(member.roles, expectedRoles)) reasons.push('ROLES');
  if (!authByEmail.has(expected.email)) reasons.push('AUTH_USER');
  if (reasons.length) userDiffs.push({ legacy_id: expected.legacy_id, issue: reasons.join(',') });
}

const dwellingDiffs = [];
for (const expected of model.dwellings) {
  const actual = dwellingByLegacy.get(expected.legacy_id);
  if (!actual) { dwellingDiffs.push({ legacy_id: expected.legacy_id, issue: 'MISSING' }); continue; }
  const responsible = profileByEmail.get(expected.responsible_email);
  const reasons = [];
  if (actual.community_id !== communityId) reasons.push('COMMUNITY');
  if (!responsible || actual.responsible_user_id !== responsible.user_id) reasons.push('RESPONSIBLE');
  if (actual.block !== expected.block || actual.floor !== expected.floor || actual.apartment !== expected.apartment) reasons.push('LOCATION');
  if (actual.state !== expected.state) reasons.push('STATE');
  if (actual.observations !== expected.observations) reasons.push('OBSERVATIONS');
  if (reasons.length) dwellingDiffs.push({ legacy_id: expected.legacy_id, issue: reasons.join(',') });
}

const vehicleDiffs = [];
for (const expected of model.vehicles) {
  const actual = vehicleByLegacy.get(expected.legacy_id);
  if (!actual) { vehicleDiffs.push({ legacy_id: expected.legacy_id, issue: 'MISSING' }); continue; }
  const expectedDwelling = dwellingByLegacy.get(expected.dwelling_legacy_id);
  const reasons = [];
  if (actual.community_id !== communityId) reasons.push('COMMUNITY');
  if (!expectedDwelling || actual.dwelling_id !== expectedDwelling.id) reasons.push('DWELLING');
  if (actual.habitual_plate !== expected.habitual_plate || actual.normalized_habitual_plate !== plate(expected.habitual_plate)) reasons.push('PLATE');
  if (actual.slot !== expected.slot) reasons.push('SLOT');
  if (actual.type !== expected.type || actual.state !== expected.state) reasons.push('TYPE_OR_STATE');
  if (normalized(actual.qr_token) !== normalized(expected.qr_token) || normalized(actual.qr_state) !== normalized(expected.qr_state)) reasons.push('QR');
  if (actual.make !== expected.make || actual.model !== expected.model || actual.observations !== expected.observations) reasons.push('DETAILS');
  if (reasons.length) vehicleDiffs.push({ legacy_id: expected.legacy_id, issue: reasons.join(',') });
}

const entityMap = new Map([
  ['USUARIOS', new Map([...profileByLegacy].map(([legacy, row]) => [legacy, row.user_id]))],
  ['VIVIENDAS', new Map([...dwellingByLegacy].map(([legacy, row]) => [legacy, row.id]))],
  ['VEHICULOS', new Map([...vehicleByLegacy].map(([legacy, row]) => [legacy, row.id]))]
]);
const auditDiffs = [];
let expectedUnresolvedAudit = 0;
for (const expected of model.audits) {
  const actual = auditByLegacy.get(expected.legacy_id);
  if (!actual) { auditDiffs.push({ legacy_id: expected.legacy_id, issue: 'MISSING' }); continue; }
  const expectedEntityId = entityMap.get(expected.entity.toUpperCase())?.get(expected.legacy_entity_id) || null;
  if (!expectedEntityId) expectedUnresolvedAudit += 1;
  const reasons = [];
  if (actual.community_id !== communityId) reasons.push('COMMUNITY');
  if (!sameTime(actual.occurred_at, expected.occurred_at)) reasons.push('DATE');
  if (normalized(actual.actor_email)?.toLowerCase() !== normalized(expected.actor_email)?.toLowerCase()) reasons.push('ACTOR');
  if (actual.action !== expected.action || actual.entity !== expected.entity) reasons.push('ACTION_OR_ENTITY');
  if (normalized(actual.legacy_entity_id) !== normalized(expected.legacy_entity_id)) reasons.push('LEGACY_ENTITY');
  if (normalized(actual.entity_id) !== normalized(expectedEntityId)) reasons.push('ENTITY_UUID');
  if (normalized(actual.field) !== normalized(expected.field) || normalized(actual.previous_value) !== normalized(expected.previous_value) || normalized(actual.new_value) !== normalized(expected.new_value)) reasons.push('VALUES');
  if (actual.observations !== expected.observations || actual.source !== 'LEGACY_SHEET') reasons.push('METADATA');
  if (reasons.length) auditDiffs.push({ legacy_id: expected.legacy_id, issue: reasons.join(',') });
}

const slotKeys = targetVehicles.filter((row) => row.slot != null).map((row) => `${row.dwelling_id}:${row.slot}`);
const specialLocationValues = [...new Set(model.dwellings.flatMap((row) => [row.block, row.floor, row.apartment]).filter((value) => /porter|ático|atico|baja|^-$/i.test(value)))];
const pureOwners = model.users.filter((user) => sameSet(user.roles, ['PROPIETARIO']));
const dualControlOwners = model.users.filter((user) => user.roles.includes('CONTROL') && user.roles.includes('PROPIETARIO'));
const ownershipStructuralDiffs = [];
for (const owner of pureOwners) {
  const profile = profileByEmail.get(owner.email);
  const expectedIds = new Set(model.dwellings.filter((row) => row.responsible_email === owner.email).map((row) => row.legacy_id));
  const actualIds = new Set(targetDwellings.filter((row) => row.responsible_user_id === profile?.user_id).map((row) => row.legacy_id));
  if (!sameSet(expectedIds, actualIds)) ownershipStructuralDiffs.push(owner.legacy_id);
}

const relationProblems = {
  vehicles_missing_dwelling: targetVehicles.filter((row) => !dwellingById.has(row.dwelling_id)).length,
  dwellings_missing_responsible: targetDwellings.filter((row) => !profiles.some((profile) => profile.user_id === row.responsible_user_id)).length,
  profiles_missing_expected_membership: model.users.filter((user) => {
    const profile = profileByLegacy.get(user.legacy_id);
    return !profile || !memberByUser.has(profile.user_id);
  }).length,
  imported_users_in_wrong_community: allMembers.filter((member) => member.community_id !== communityId && model.users.some((user) => profileByLegacy.get(user.legacy_id)?.user_id === member.user_id)).length,
  vehicle_cross_community: targetVehicles.filter((row) => dwellingById.get(row.dwelling_id)?.community_id !== row.community_id).length,
  dwelling_responsible_cross_community: targetDwellings.filter((row) => !allMembers.some((member) => member.community_id === row.community_id && member.user_id === row.responsible_user_id)).length,
  periods_missing_vehicle: targetPeriods.filter((row) => !vehicleById.has(row.vehicle_id)).length,
  followups_missing_incident: followups.filter((row) => !incidents.some((incident) => incident.id === row.incident_id)).length,
  controls_missing_user_or_vehicle: [...qrControls, ...plateControls].filter((row) => row.user_id && !profiles.some((profile) => profile.user_id === row.user_id) || row.vehicle_id && !vehicleById.has(row.vehicle_id)).length
};

let liveRlsResult = sqlRlsValidated > 0
  ? { executed: true, method: 'DATABASE_ROLE_IMPERSONATION', tested_pure_owners: sqlRlsValidated, failures: [], note: 'Validado por migración transaccional 117; aborta ante cualquier conjunto visible distinto.' }
  : { executed: false, tested_pure_owners: 0, failures: [], note: 'No ejecutado; usar --live-rls o --rls-sql-validated.' };
if (liveRls) {
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!anonKey || /replace-with/i.test(anonKey)) throw new Error('--live-rls requiere SUPABASE_ANON_KEY');
  liveRlsResult = { executed: true, tested_pure_owners: 0, failures: [], note: 'CONTROL+PROPIETARIO conserva visibilidad operativa de CONTROL; se probaron propietarios puros.' };
  for (const owner of pureOwners) {
    const link = await client.auth.admin.generateLink({ type: 'magiclink', email: owner.email });
    if (link.error) { liveRlsResult.failures.push({ legacy_id: owner.legacy_id, issue: 'GENERATE_LINK' }); continue; }
    const tokenHash = link.data.properties?.hashed_token;
    const userClient = createClient(process.env.SUPABASE_URL, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const verified = await userClient.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
    if (verified.error || !verified.data.session) { liveRlsResult.failures.push({ legacy_id: owner.legacy_id, issue: 'VERIFY_OTP' }); continue; }
    const scoped = createClient(process.env.SUPABASE_URL, anonKey, { global: { headers: { Authorization: `Bearer ${verified.data.session.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const visible = await scoped.from('dwellings').select('legacy_id').order('legacy_id');
    if (visible.error) { liveRlsResult.failures.push({ legacy_id: owner.legacy_id, issue: 'QUERY' }); continue; }
    const expected = model.dwellings.filter((row) => row.responsible_email === owner.email).map((row) => row.legacy_id);
    if (!sameSet(visible.data.map((row) => row.legacy_id), expected)) liveRlsResult.failures.push({ legacy_id: owner.legacy_id, issue: 'VISIBLE_SET_MISMATCH' });
    liveRlsResult.tested_pure_owners += 1;
  }
}

const checks = [
  check('imported_profiles_count', importedProfiles.length === 77, { expected: 77, actual: importedProfiles.length, total_profiles_including_test_accounts: profiles.length }),
  check('imported_auth_users_count', importedAuthCount === 77, { expected: 77, actual: importedAuthCount, total_auth_users_including_test_accounts: auth.length }),
  check('profile_emails_unique', duplicates(profiles.map((row) => row.email.toLowerCase())).length === 0),
  check('sheet_users_match_profiles_auth_roles', userDiffs.length === 0, { differences: userDiffs }),
  check('imported_community_members_count', importedMembers.length === 77, { expected: 77, actual: importedMembers.length, total_members_including_test_accounts: targetMembers.length }),
  check('owner_dwelling_mapping_structural', ownershipStructuralDiffs.length === 0, { pure_owners: pureOwners.length, control_owner_exception: dualControlOwners.length, differences: ownershipStructuralDiffs }),
  check('dwellings_count', targetDwellings.length === 77, { expected: 77, actual: targetDwellings.length }),
  check('dwellings_exact', dwellingDiffs.length === 0, { differences: dwellingDiffs }),
  check('dwellings_legacy_unique', duplicates(targetDwellings.map((row) => row.legacy_id)).length === 0),
  check('vehicles_count', targetVehicles.length === 35, { expected: 35, actual: targetVehicles.length }),
  check('vehicles_exact', vehicleDiffs.length === 0, { differences: vehicleDiffs }),
  check('vehicle_plates_unique', duplicates(targetVehicles.map((row) => row.normalized_habitual_plate)).length === 0),
  check('vehicle_legacy_unique', duplicates(targetVehicles.map((row) => row.legacy_id)).length === 0),
  check('qr_unique', duplicates(targetVehicles.map((row) => row.qr_token)).length === 0),
  check('slots_unique_per_dwelling', duplicates(slotKeys).length === 0),
  check('motorcycles_rules', targetVehicles.filter((row) => row.type === 'Moto').length === 4 && targetVehicles.filter((row) => row.type === 'Moto').every((row) => row.state === 'Activo' && row.slot == null && row.qr_token == null)),
  check('relations_integrity', Object.values(relationProblems).every((value) => value === 0), { differences: relationProblems }),
  check('audit_count', targetAudits.length === model.audits.length, { expected: model.audits.length, actual: targetAudits.length }),
  check('audit_exact_and_source', auditDiffs.length === 0, { differences: auditDiffs }),
  check('audit_legacy_unique', duplicates(targetAudits.map((row) => row.legacy_id)).length === 0),
  check('audit_unresolved_explained', targetAudits.filter((row) => row.legacy_entity_id && !row.entity_id).length === expectedUnresolvedAudit, { expected: expectedUnresolvedAudit, actual: targetAudits.filter((row) => row.legacy_entity_id && !row.entity_id).length }),
  check('no_functional_side_effect_rows', requests.length === 0 && incidents.length === 0 && followups.length === 0 && qrControls.length === 0 && plateControls.length === 0, { requests: requests.length, incidents: incidents.length, followups: followups.length, qr_controls: qrControls.length, plate_controls: plateControls.length }),
  check('settings_count', settings.filter((row) => row.community_id === communityId).length === 8, { expected: 8, actual: settings.filter((row) => row.community_id === communityId).length }),
  check('live_rls_owner_isolation', liveRlsResult.executed && liveRlsResult.tested_pure_owners === pureOwners.length && liveRlsResult.failures.length === 0, liveRlsResult)
];

const report = {
  generated_at: new Date().toISOString(), source_file: file.split('/').at(-1), source_sha256: model.source.sha256,
  community_id: communityId, community_slug: community.slug,
  overall_data_status: checks.every((item) => item.ok) ? 'OK' : 'FAILED',
  auth_end_to_end_status: jitRealValidated ? 'OK' : jitSyntheticValidated ? 'SYNTHETIC_OK_REAL_ACCOUNT_PENDING' : 'PENDING_REAL_ACCOUNT_TEST', checks,
  reconciliation: {
    users: { sheet: model.users.length, supabase_profiles: importedProfiles.length, imported_auth_users: importedAuthCount, total_profiles_including_test_accounts: profiles.length, total_members_including_test_accounts: targetMembers.length, total_auth_users_including_test_accounts: auth.length, differences: userDiffs.length },
    dwellings: { sheet: model.dwellings.length, supabase: targetDwellings.length, differences: dwellingDiffs.length, special_values_preserved: specialLocationValues },
    vehicles: { sheet: model.vehicles.length, supabase: targetVehicles.length, differences: vehicleDiffs.length },
    audit: { sheet: model.audits.length, supabase: targetAudits.length, differences: auditDiffs.length, unresolved_entity_uuid_explained: expectedUnresolvedAudit },
    duplicate_emails: duplicates(profiles.map((row) => row.email.toLowerCase())).length,
    duplicate_plates: duplicates(targetVehicles.map((row) => row.normalized_habitual_plate)).length,
    duplicate_qr: duplicates(targetVehicles.map((row) => row.qr_token)).length,
    slot_conflicts: duplicates(slotKeys).length,
    unresolved_relations: Object.values(relationProblems).reduce((sum, value) => sum + value, 0),
    duplicate_legacy_ids: {
      users: duplicates(profiles.filter((row) => row.legacy_id).map((row) => row.legacy_id)).length,
      dwellings: duplicates(targetDwellings.map((row) => row.legacy_id)).length,
      vehicles: duplicates(targetVehicles.map((row) => row.legacy_id)).length,
      audit: duplicates(targetAudits.map((row) => row.legacy_id)).length
    }
  },
  roles: Object.fromEntries(['ADMIN','CONTROL','PROPIETARIO'].map((role) => [role, importedMembers.filter((row) => row.roles.includes(role)).length])),
  vehicles: { motorcycles: targetVehicles.filter((row) => row.type === 'Moto').length, with_qr: targetVehicles.filter((row) => row.qr_token).length, slot_1: targetVehicles.filter((row) => row.slot === 1).length, slot_2: targetVehicles.filter((row) => row.slot === 2).length, without_slot: targetVehicles.filter((row) => row.slot == null).length },
  live_rls: liveRlsResult,
  auth_validation: {
    legacy_algorithm: 'SHA256_HEX_UTF8 iterado: salt|password, luego salt|hash; v2, 1000 iteraciones, sin normalizar password',
    supabase_native_compatibility: false,
    chosen_mechanism: 'JIT_FIRST_LOGIN',
    synthetic_end_to_end: jitSyntheticValidated ? 'OK' : 'NOT_EXECUTED',
    real_existing_account: jitRealValidated ? 'OK' : 'PENDING_OWNER_EXECUTION',
    vault_status: authMigrationStatus,
    purge_performed: false
  },
  notes: [
    `Las ${expectedUnresolvedAudit} referencias históricas de auditoría no resolubles conservan legacy_entity_id y entity_id NULL.`,
    'CONTROL+PROPIETARIO mantiene visibilidad operativa de CONTROL; la exclusividad se aplica a PROPIETARIO puro.',
    jitRealValidated
      ? 'La prueba con credencial legacy existente completó primer login JIT, logout y segundo login nativo sin cambiar la contraseña.'
      : 'La prueba de contraseña real requiere una cuenta existente y su contraseña actual, proporcionada o ejecutada por su titular.'
  ]
};

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ overall_data_status: report.overall_data_status, auth_end_to_end_status: report.auth_end_to_end_status, checks_ok: checks.filter((item) => item.ok).length, checks_total: checks.length, report: reportPath }, null, 2));
if (report.overall_data_status !== 'OK' || (liveRls && liveRlsResult.failures.length)) process.exitCode = 2;
