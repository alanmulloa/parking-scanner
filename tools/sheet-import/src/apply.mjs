import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const chunk = (values, size = 200) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));

function assertResult(result, context) {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
}

async function upsertBatches(client, table, rows, onConflict, counters) {
  if (!rows.length) return;
  for (const batch of chunk(rows)) {
    assertResult(await client.from(table).upsert(batch, { onConflict, ignoreDuplicates: false }), `upsert ${table}`);
  }
  counters[table] = rows.length;
}

async function mapByLegacy(client, table, communityId) {
  const rows = assertResult(await client.from(table).select('id,legacy_id').eq('community_id', communityId), `mapa ${table}`) || [];
  return new Map(rows.filter((row) => row.legacy_id).map((row) => [row.legacy_id, row.id]));
}

async function listAuthUsers(client) {
  const byEmail = new Map();
  const byId = new Map();
  for (let page = 1; ; page += 1) {
    const response = await client.auth.admin.listUsers({ page, perPage: 1000 });
    const users = assertResult(response, 'listar auth.users')?.users || [];
    for (const user of users) {
      byId.set(user.id, user);
      if (user.email) byEmail.set(user.email.toLowerCase(), user);
    }
    if (users.length < 1000) break;
  }
  return { byEmail, byId };
}

export function makeServiceClient(url, key) {
  if (!url || !key) throw new Error('APPLY requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
}

export async function applyModel(client, model) {
  const counters = { inserts_or_updates: {}, skips: {} };
  const run = assertResult(await client.from('migration_runs').insert({
    source_file: model.source.file.split('/').at(-1), source_sha256: model.source.sha256,
    mode: 'APPLY', state: 'RUNNING', counts: {}, importer_version: model.source.importer_version
  }).select('id').single(), 'crear migration_run');

  try {
    const community = assertResult(await client.from('communities').upsert({
      legacy_id: model.community.legacy_id, slug: model.community.slug, name: model.community.name,
      description: model.community.description, short_description: model.community.description,
      contact_email: model.community.contact_email, address: model.community.address, state: model.community.state
    }, { onConflict: 'slug' }).select('id').single(), 'upsert communities');
    const communityId = community.id;
    assertResult(await client.from('migration_runs').update({ community_id: communityId }).eq('id', run.id), 'asociar migration_run');

    await upsertBatches(client, 'community_settings', Object.entries(model.settings).map(([key, value]) => ({ community_id: communityId, key, value })), 'community_id,key', counters.inserts_or_updates);

    const existingProfiles = assertResult(
      await client.from('profiles').select('user_id,legacy_id,email').not('legacy_id', 'is', null),
      'listar perfiles existentes'
    ) || [];
    const existingProfileByLegacy = new Map(existingProfiles.map((row) => [row.legacy_id, row]));
    const existingUserByEmail = new Map(existingProfiles.map((row) => [String(row.email).toLowerCase(), row.user_id]));
    const authUsers = await listAuthUsers(client);
    const authByEmail = authUsers.byEmail;
    for (const legacyUser of model.users) {
      let authUser = authByEmail.get(legacyUser.email);
      const existingProfile = existingProfileByLegacy.get(legacyUser.legacy_id);
      if (!authUser && existingProfile) {
        authUser = authUsers.byId.get(existingProfile.user_id);
        if (!authUser) throw new Error(`Perfil sin auth.users para ${legacyUser.legacy_id}`);
        const updated = assertResult(await client.auth.admin.updateUserById(authUser.id, {
          email: legacyUser.email,
          email_confirm: true,
          user_metadata: { ...(authUser.user_metadata || {}), legacy_id: legacyUser.legacy_id }
        }), `actualizar email auth ${legacyUser.legacy_id}`);
        authUser = updated.user;
        if (existingProfile.email) authByEmail.delete(String(existingProfile.email).toLowerCase());
        authByEmail.set(legacyUser.email, authUser);
        authUsers.byId.set(authUser.id, authUser);
      }
      if (!authUser) {
        const created = assertResult(await client.auth.admin.createUser({
          email: legacyUser.email,
          password: randomBytes(48).toString('base64url'),
          email_confirm: true,
          user_metadata: { legacy_id: legacyUser.legacy_id, migration_pending: true }
        }), `crear auth user ${legacyUser.legacy_id}`);
        authUser = created.user;
        authByEmail.set(legacyUser.email, authUser);
      }
      legacyUser.user_id = authUser.id;
    }

    await upsertBatches(client, 'profiles', model.users.map((user) => ({
      user_id: user.user_id, legacy_id: user.legacy_id, email: user.email, name: user.name,
      phone: user.phone, state: user.state, is_root: user.roles.includes('ROOT'), last_access_at: user.last_access_at
    })), 'user_id', counters.inserts_or_updates);

    await upsertBatches(client, 'community_members', model.users.filter((user) => user.roles.some((role) => role !== 'ROOT')).map((user) => ({
      community_id: communityId, user_id: user.user_id, roles: user.roles.filter((role) => role !== 'ROOT'), state: user.state
    })), 'community_id,user_id', counters.inserts_or_updates);

    const userByEmail = new Map([
      ...existingUserByEmail,
      ...model.users.map((user) => [user.email, user.user_id])
    ]);
    const userByLegacy = new Map(model.users.map((user) => [user.legacy_id, user.user_id]));

    for (const user of model.users) {
      assertResult(await client.rpc('import_legacy_auth_credential', {
        target_user_id: user.user_id,
        target_legacy_user_id: user.legacy_id,
        target_email: user.email,
        target_password_hash: user.credential.hash,
        target_password_salt: user.credential.salt,
        target_algorithm: user.credential.algorithm,
        target_iterations: user.credential.iterations,
        target_failed_attempts: user.failed_attempts,
        target_locked_until: user.locked_until,
        target_password_changed_at: user.password_changed_at,
        target_session_version: user.session_version
      }), `credencial legacy ${user.legacy_id}`);
    }
    counters.inserts_or_updates.legacy_auth_credentials = model.users.length;

    await upsertBatches(client, 'dwellings', model.dwellings.map((row) => ({
      community_id: communityId, legacy_id: row.legacy_id, block: row.block, floor: row.floor,
      apartment: row.apartment, display_name: row.display_name,
      responsible_user_id: userByEmail.get(row.responsible_email) || userByEmail.get(row.source_responsible_email), state: row.state,
      observations: row.observations, created_at: row.created_at
    })), 'community_id,legacy_id', counters.inserts_or_updates);
    const dwellingByLegacy = await mapByLegacy(client, 'dwellings', communityId);

    await upsertBatches(client, 'vehicles', model.vehicles.map((row) => ({
      community_id: communityId, legacy_id: row.legacy_id, dwelling_id: dwellingByLegacy.get(row.dwelling_legacy_id),
      slot: row.slot, habitual_plate: row.habitual_plate,
      make: row.make, model: row.model, type: row.type, state: row.state, qr_token: row.qr_token,
      qr_state: row.qr_state, observations: row.observations, created_at: row.created_at
    })), 'community_id,legacy_id', counters.inserts_or_updates);
    const vehicleByLegacy = await mapByLegacy(client, 'vehicles', communityId);

    await upsertBatches(client, 'temporary_periods', model.temporaryPeriods.map((row) => ({
      community_id: communityId, legacy_id: row.legacy_id, vehicle_id: vehicleByLegacy.get(row.vehicle_legacy_id),
      temporary_plate: row.temporary_plate, starts_at: row.starts_at, ends_at: row.ends_at,
      state: row.state, created_by: row.created_by_email ? userByEmail.get(row.created_by_email) : null,
      observations: row.observations, created_at: row.created_at || undefined
    })), 'community_id,legacy_id', counters.inserts_or_updates);

    await upsertBatches(client, 'requests', model.requests.map((row) => ({
      community_id: communityId, legacy_id: row.legacy_id, requested_at: row.requested_at,
      requested_by: userByEmail.get(row.requested_by_email), dwelling_id: dwellingByLegacy.get(row.dwelling_legacy_id),
      vehicle_id: row.vehicle_legacy_id ? vehicleByLegacy.get(row.vehicle_legacy_id) : null,
      type: row.type, state: row.state, reason: row.reason, resolved_at: row.resolved_at,
      resolved_by: row.resolved_by_email ? userByEmail.get(row.resolved_by_email) : null,
      resolution_notes: row.resolution_notes, origin_vehicle_state: row.origin_vehicle_state,
      origin_qr_state: row.origin_qr_state, origin_vehicle_type: row.origin_vehicle_type,
      origin_slot: row.origin_slot, origin_plate: row.origin_plate, start_date: row.start_date, end_date: row.end_date
    })), 'community_id,legacy_id', counters.inserts_or_updates);

    await upsertBatches(client, 'incidents', model.incidents.map((row) => ({
      community_id: communityId, legacy_id: row.legacy_id, occurred_at: row.occurred_at,
      created_by: userByEmail.get(row.created_by_email), observed_plate: row.observed_plate,
      infraction_plate: row.infraction_plate, authorized_plate: row.authorized_plate,
      dwelling_id: row.dwelling_legacy_id ? dwellingByLegacy.get(row.dwelling_legacy_id) : null,
      vehicle_id: row.vehicle_legacy_id ? vehicleByLegacy.get(row.vehicle_legacy_id) : null,
      type: row.type, description: row.description, photo_url: row.legacy_photo_url, state: row.state,
      closed_at: row.closed_at, closed_by: row.closed_by_email ? userByEmail.get(row.closed_by_email) : null,
      control_origin: row.control_origin, origin_state: row.origin_state, close_action: row.close_action,
      close_comment: row.close_comment, origin_vehicle_state: row.origin_vehicle_state,
      origin_qr_state: row.origin_qr_state, origin_vehicle_type: row.origin_vehicle_type,
      origin_slot: row.origin_slot, origin_habitual_plate: row.origin_habitual_plate,
      expired_itv: row.expired_itv, event_id: row.event_id, situation: row.situation, cause: row.cause,
      related_dwelling_id: row.related_dwelling_legacy_id ? dwellingByLegacy.get(row.related_dwelling_legacy_id) : null,
      related_vehicle_id: row.related_vehicle_legacy_id ? vehicleByLegacy.get(row.related_vehicle_legacy_id) : null,
      related_plate: row.related_plate, attempts: row.attempts, priority: row.priority,
      last_followup_at: row.last_followup_at, fluid_leak: row.fluid_leak
    })), 'community_id,legacy_id', counters.inserts_or_updates);
    const incidentByLegacy = await mapByLegacy(client, 'incidents', communityId);

    await upsertBatches(client, 'incident_followups', model.followups.map((row) => ({
      community_id: communityId, legacy_id: row.legacy_id, incident_id: incidentByLegacy.get(row.incident_legacy_id),
      event_id: row.event_id, followup_event_id: row.followup_event_id, occurred_at: row.occurred_at,
      created_by: userByEmail.get(row.created_by_email), attempt_number: row.attempt_number,
      observed_plate: row.observed_plate, authorized_plate: row.authorized_plate,
      control_origin: row.control_origin, origin_state: row.origin_state, situation: row.situation,
      related_dwelling_id: row.related_dwelling_legacy_id ? dwellingByLegacy.get(row.related_dwelling_legacy_id) : null,
      related_vehicle_id: row.related_vehicle_legacy_id ? vehicleByLegacy.get(row.related_vehicle_legacy_id) : null,
      related_plate: row.related_plate, observation: row.observation, photo_url: row.legacy_photo_url
    })), 'community_id,legacy_id', counters.inserts_or_updates);

    const entityMaps = new Map([
      ['USUARIOS', userByLegacy], ['VIVIENDAS', dwellingByLegacy], ['VEHICULOS', vehicleByLegacy], ['INCIDENCIAS', incidentByLegacy]
    ]);
    await upsertBatches(client, 'audit_log', model.audits.map((row) => ({
      community_id: communityId, legacy_id: row.legacy_id, occurred_at: row.occurred_at,
      user_id: row.actor_email ? userByEmail.get(row.actor_email) || null : null,
      actor_user_id: row.actor_email ? userByEmail.get(row.actor_email) || null : null,
      actor_email: row.actor_email, action: row.action, entity: row.entity,
      entity_id: row.legacy_entity_id ? entityMaps.get(row.entity.toUpperCase())?.get(row.legacy_entity_id) || null : null,
      legacy_entity_id: row.legacy_entity_id, field: row.field, previous_value: row.previous_value,
      new_value: row.new_value, observations: row.observations, source: row.source
    })), 'community_id,legacy_id', counters.inserts_or_updates);

    await upsertBatches(client, 'qr_controls', model.qrControls.map((row) => ({
      community_id: communityId, legacy_id: row.legacy_id, user_id: userByEmail.get(row.user_email),
      occurred_at: row.occurred_at, scanned_code: row.scanned_code, result: row.result, metadata: row.metadata
    })), 'community_id,legacy_id', counters.inserts_or_updates);
    await upsertBatches(client, 'plate_controls', model.plateControls.map((row) => ({
      community_id: communityId, legacy_id: row.legacy_id, user_id: userByEmail.get(row.user_email),
      occurred_at: row.occurred_at, searched_plate: row.searched_plate, result: row.result, metadata: row.metadata
    })), 'community_id,legacy_id', counters.inserts_or_updates);

    const counts = await reconcileCounts(client, communityId);
    assertResult(await client.from('migration_runs').update({
      state: 'SUCCEEDED', finished_at: new Date().toISOString(), counts,
      inserts: counters.inserts_or_updates, skips: counters.skips, errors: []
    }).eq('id', run.id), 'finalizar migration_run');
    return { run_id: run.id, community_id: communityId, counts, operations: counters };
  } catch (error) {
    await client.from('migration_runs').update({
      state: 'FAILED', finished_at: new Date().toISOString(), errors: [{ message: error.message }]
    }).eq('id', run.id);
    throw error;
  }
}

export async function reconcileCounts(client, communityId) {
  const tables = ['community_settings', 'community_members', 'dwellings', 'vehicles', 'temporary_periods', 'requests', 'incidents', 'incident_followups', 'audit_log', 'qr_controls', 'plate_controls'];
  const counts = {};
  for (const table of tables) {
    const result = await client.from(table).select('*', { count: 'exact', head: true }).eq('community_id', communityId);
    assertResult(result, `reconciliar ${table}`);
    counts[table] = result.count || 0;
  }
  return counts;
}
