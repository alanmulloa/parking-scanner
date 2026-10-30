import { createClient } from 'npm:@supabase/supabase-js@2';
import { isAllowedOrigin, jsonResponse, optionsResponse } from '../_shared/http.ts';

const allowedRoles = new Set(['ADMIN', 'CONTROL', 'PROPIETARIO']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AnyRow = Record<string, any>;

function passwordValue() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const value = btoa(String.fromCharCode(...bytes)).replace(/[^A-Za-z0-9]/g, 'A').slice(0, 18);
  return `${value}a1`;
}

function normalizedRoles(value: unknown): string[] {
  const roles = String(value || '').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
  if (!roles.length || roles.length > 2 || roles.some((role) => !allowedRoles.has(role))) throw new Error('Perfiles no válidos.');
  if (roles.includes('ADMIN') && roles.includes('CONTROL')) throw new Error('ADMIN + CONTROL no es una combinación permitida.');
  return [...new Set(roles)];
}

function normalizeKey(value: unknown) {
  return String(value ?? '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '');
}

function normalizeFloor(value: unknown) {
  const raw = String(value ?? '').trim().replace(/[º°]/g, '').replace(/\s+/g, ' ');
  const key = raw.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (['PB', 'BAJA', 'BAJO', '0'].includes(key)) return 'Baja';
  if (key === 'ATICO') return 'Ático';
  return raw;
}

function normalizeApartment(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function locationKey(block: unknown, floor: unknown, apartment: unknown) {
  return [block, floor, apartment].map(normalizeKey).join('|');
}

function housingLabel(row: AnyRow) {
  return `Bloque ${String(row.block ?? row.Bloque ?? '').trim()}, ${normalizeFloor(row.floor ?? row.Planta)} ${normalizeApartment(row.apartment ?? row.Apartamento)}`;
}

function parseHousing(raw: AnyRow) {
  let block = String(raw.Bloque ?? raw.bloque ?? '').trim();
  let floor = String(raw.Planta ?? raw.planta ?? '').trim();
  let apartment = String(raw.Apartamento ?? raw.apartamento ?? raw.Puerta ?? raw.puerta ?? '').trim();
  const vivienda = String(raw.Vivienda ?? raw.vivienda ?? '').trim();
  if (!(block && floor && apartment) && vivienda) {
    const match = vivienda.match(/^Bloque\s+(.+?)\s*,\s*(\S+)\s+(.+)$/i) || vivienda.match(/^(.+?)\s*,\s*(\S+)\s+(.+)$/i);
    if (match) {
      if (!block) block = match[1].trim();
      if (!floor) floor = match[2].trim();
      if (!apartment) apartment = match[3].trim();
    }
  }
  block = block.replace(/^Bloque\s+/i, '').trim();
  floor = normalizeFloor(floor);
  apartment = normalizeApartment(apartment);
  return {
    block,
    floor,
    apartment,
    vivienda,
    hasLocation: Boolean(block && floor && apartment),
    locationKey: block && floor && apartment ? locationKey(block, floor, apartment) : ''
  };
}

function rolesWithOwner(roles: string[]) {
  const out = [...new Set((roles || []).map((role) => String(role).toUpperCase()).filter(Boolean))];
  if (!out.includes('PROPIETARIO')) out.push('PROPIETARIO');
  return normalizedRoles(out.join(','));
}


function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function legacyBridgeRequest(action: string, payload: Record<string, unknown> = {}) {
  const endpoint = String(Deno.env.get('LEGACY_APPS_SCRIPT_URL') || '').trim();
  const secret = String(Deno.env.get('LEGACY_BRIDGE_SECRET') || '').trim();
  if (!endpoint || !secret) throw new Error('Bridge Apps Script no configurado. Faltan LEGACY_APPS_SCRIPT_URL / LEGACY_BRIDGE_SECRET.');
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const payloadJson = JSON.stringify(payload || {});
  const message = [String(ts), nonce, action, payloadJson].join('\n');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ts, nonce, action, payloadJson, signature }),
    redirect: 'follow'
  });
  const textBody = await response.text();
  let body: AnyRow = {};
  try { body = JSON.parse(textBody || '{}'); } catch { throw new Error(`Bridge Apps Script devolvió una respuesta no válida (${response.status}).`); }
  if (!response.ok || body.ok === false || Number(body.status || 200) >= 400) throw new Error(String(body.error || `Bridge Apps Script respondió ${response.status}.`));
  return body.data ?? body;
}

async function ownerImportSnapshot(service: any, communityId: string) {
  const [housingResult, profilesResult, membersResult] = await Promise.all([
    service.from('dwellings').select('id,legacy_id,block,floor,apartment,display_name,responsible_user_id,state,observations').eq('community_id', communityId),
    service.from('profiles').select('user_id,email,name,state,is_root'),
    service.from('community_members').select('user_id,roles,state').eq('community_id', communityId)
  ]);
  if (housingResult.error) throw housingResult.error;
  if (profilesResult.error) throw profilesResult.error;
  if (membersResult.error) throw membersResult.error;
  const memberByUser = new Map<string, AnyRow>((membersResult.data || []).map((row: AnyRow) => [String(row.user_id), row]));
  const users = (profilesResult.data || []).filter((row: AnyRow) => !row.is_root).map((row: AnyRow) => ({
    ...row,
    roles: memberByUser.get(row.user_id)?.roles || [],
    member_state: memberByUser.get(row.user_id)?.state || 'Inactivo'
  }));
  return { housing: housingResult.data || [], users };
}

function buildOwnerPreview(importRows: AnyRow[], housing: AnyRow[], users: AnyRow[], createMissingHousing: boolean) {
  const byId = new Map<string, AnyRow>();
  const byLegacyId = new Map<string, AnyRow>();
  const byLocation = new Map<string, AnyRow>();
  const byKey = new Map<string, AnyRow>();
  for (const h of housing) {
    byId.set(String(h.id), h);
    if (h.legacy_id) byLegacyId.set(String(h.legacy_id), h);
    const loc = locationKey(h.block, h.floor, h.apartment);
    if (loc && !byLocation.has(loc)) byLocation.set(loc, h);
    for (const label of [h.display_name, housingLabel(h), `${h.block} ${h.floor} ${h.apartment}`, `${h.block}, ${h.floor} ${h.apartment}`]) {
      const key = normalizeKey(label);
      if (key && !byKey.has(key)) byKey.set(key, h);
    }
  }
  const userByEmail = new Map(users.map((u) => [String(u.email || '').trim().toLowerCase(), u]));
  const seenHousing = new Set<string>();
  const emailNames = new Map<string, string>();
  const preview: AnyRow[] = [];

  importRows.forEach((raw, index) => {
    const parsed = parseHousing(raw || {});
    const viviendaInput = String(raw?.Vivienda ?? raw?.vivienda ?? '').trim();
    const idInput = String(raw?.ID_Vivienda ?? raw?.IdVivienda ?? raw?.id_vivienda ?? '').trim();
    const name = String(raw?.Propietario ?? raw?.propietario ?? raw?.Nombre ?? raw?.nombre ?? '').trim();
    const email = String(raw?.Email ?? raw?.email ?? raw?.Mail ?? raw?.mail ?? '').trim().toLowerCase();
    const stateInput = String(raw?.Estado ?? raw?.estado ?? 'Activa').trim() || 'Activa';
    const observations = String(raw?.Observaciones ?? raw?.observaciones ?? '').trim();
    const errors: string[] = [];
    let h: AnyRow | null = null;

    if (idInput) {
      h = byId.get(idInput) || byLegacyId.get(idInput) || null;
      if (!h && parsed.locationKey && byLocation.has(parsed.locationKey)) errors.push(`El ID_Vivienda no existe, pero esa vivienda ya está registrada como ${byLocation.get(parsed.locationKey)?.id}`);
    } else {
      h = (parsed.locationKey && byLocation.get(parsed.locationKey)) || byKey.get(normalizeKey(viviendaInput)) || null;
    }

    if (h && parsed.hasLocation && locationKey(h.block, h.floor, h.apartment) !== parsed.locationKey) errors.push('ID_Vivienda y ubicación no corresponden a la misma vivienda');
    const creating = !h;
    if (creating && !createMissingHousing) errors.push("Vivienda no encontrada. Activa 'Crear viviendas faltantes' para darla de alta.");
    if (creating && createMissingHousing && !parsed.hasLocation) errors.push("Para crear una vivienda faltan Bloque, Planta y Apartamento (o usa Vivienda con formato 'Bloque X, Y Z').");
    const normalizedState = ['Activa', 'Activo'].includes(stateInput) ? 'Activo' : ['Inactiva', 'Inactivo'].includes(stateInput) ? 'Inactivo' : '';
    if (!normalizedState) errors.push('Estado de vivienda no válido (Activa/Inactiva)');
    if (!name) errors.push('Falta propietario');
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) errors.push('Email no válido');

    const logicalKey = h ? `ID:${h.id}` : parsed.locationKey ? `LOC:${parsed.locationKey}` : `ROW:${index + 2}`;
    if (seenHousing.has(logicalKey)) errors.push('Vivienda repetida en el archivo');
    seenHousing.add(logicalKey);

    if (email && name) {
      const key = normalizeKey(name);
      if (emailNames.has(email) && emailNames.get(email) !== key) errors.push('El mismo email aparece con nombres distintos');
      else emailNames.set(email, key);
    }

    const existing = email ? userByEmail.get(email) : null;
    if (existing) {
      try { rolesWithOwner(existing.roles || []); } catch { errors.push('El usuario ya tiene perfiles incompatibles y no se puede añadir PROPIETARIO'); }
    }

    const effective: AnyRow = {
      rowNumber: index + 2,
      Vivienda: h ? (h.display_name || housingLabel(h)) : parsed.hasLocation ? housingLabel({ block: parsed.block, floor: parsed.floor, apartment: parsed.apartment }) : viviendaInput,
      ID_Vivienda: h ? h.id : idInput,
      LegacyID: h ? (h.legacy_id || '') : (uuidPattern.test(idInput) ? '' : idInput),
      Bloque: h ? String(h.block || '') : parsed.block,
      Planta: h ? String(h.floor || '') : parsed.floor,
      Apartamento: h ? String(h.apartment || '') : parsed.apartment,
      Estado: h ? (h.state === 'Activo' ? 'Activa' : 'Inactiva') : (normalizedState === 'Activo' ? 'Activa' : 'Inactiva'),
      Observaciones: h ? String(h.observations || '') : observations,
      Propietario: name,
      Email: email,
      createHousing: creating,
      status: errors.length ? 'ERROR' : 'OK',
      message: errors.join(' · '),
      action: ''
    };

    if (!errors.length) {
      const actions: string[] = [creating ? 'Crear vivienda' : 'Vivienda existente'];
      if (!existing) actions.push('Crear usuario PROPIETARIO');
      else {
        if (!(existing.roles || []).includes('PROPIETARIO')) actions.push('Añadir perfil PROPIETARIO');
        if (existing.state !== 'Activo') actions.push('Activar usuario');
        if (String(existing.name || '') !== name) actions.push('Actualizar nombre');
      }
      const currentOwner = h?.responsible_user_id ? users.find((u) => u.user_id === h.responsible_user_id) : null;
      if (!creating && String(currentOwner?.email || '').toLowerCase() !== email) actions.push(currentOwner ? 'Reasignar vivienda' : 'Asignar vivienda');
      if (creating) actions.push('Asignar propietario');
      effective.action = actions.join(' · ');
    }
    preview.push(effective);
  });

  const valid = preview.filter((row) => row.status === 'OK');
  const uniqueUsers = new Set(valid.map((row) => row.Email));
  return {
    ok: preview.length > 0 && valid.length === preview.length,
    total: preview.length,
    validCount: valid.length,
    errorCount: preview.length - valid.length,
    uniqueUsers: uniqueUsers.size,
    housingToCreate: valid.filter((row) => row.createHousing).length,
    housingExisting: valid.filter((row) => !row.createHousing).length,
    createMissingHousing,
    rows: preview
  };
}


const BACKUP_TABLES = [
  'communities',
  'profiles',
  'community_members',
  'community_settings',
  'dwellings',
  'vehicles',
  'temporary_periods',
  'requests',
  'incidents',
  'incident_followups',
  'audit_log',
  'qr_controls',
  'plate_controls'
] as const;

async function buildBackupExport(adminClient: any) {
  const exported: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  for (const table of BACKUP_TABLES) {
    const { data, error } = await adminClient
      .from(table)
      .select('*');

    if (error) {
      throw new Error(`Backup ${table}: ${error.message}`);
    }

    exported[table] = data || [];
    counts[table] = (data || []).length;
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    version: 'backup-v1',
    tables: exported,
    counts
  };
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return optionsResponse(origin);
  if (request.method !== 'POST' || !isAllowedOrigin(origin)) return jsonResponse(405, { error: 'Solicitud no válida' }, origin);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!url || !anonKey || !serviceKey || !bearer) return jsonResponse(401, { error: 'Sesión no válida' }, origin);

  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const actorResult = await authClient.auth.getUser(bearer);
  const actorId = actorResult.data.user?.id;
  if (actorResult.error || !actorId) return jsonResponse(401, { error: 'Sesión no válida' }, origin);

  const actorProfile = await service.from('profiles').select('user_id,email,is_root,state').eq('user_id', actorId).single();
  if (actorProfile.error || actorProfile.data.state !== 'Activo') return jsonResponse(403, { error: 'Perfil sin acceso' }, origin);
  const membership = await service.from('community_members').select('community_id,roles,state').eq('user_id', actorId).eq('state', 'Activo').limit(1).maybeSingle();
  const isAdmin = actorProfile.data.is_root || Boolean(membership.data?.roles?.includes('ADMIN'));
  if (!isAdmin) return jsonResponse(403, { error: 'Acceso exclusivo de administración' }, origin);

  let actorAuditEmail = actorProfile.data.email;
  if (actorProfile.data.is_root) {
    const rootIdentity = await service.rpc('technical_root_identity', { target_user_id: actorId });
    if (rootIdentity.error) return jsonResponse(400, { error: 'No se pudo resolver la identidad técnica ROOT.' }, origin);
    const visibleRoot = Array.isArray(rootIdentity.data) ? rootIdentity.data[0] : null;
    if (!visibleRoot?.login_email) return jsonResponse(400, { error: 'ROOT técnico sin identidad visible configurada.' }, origin);
    actorAuditEmail = visibleRoot.login_email;
  }

  let actorCommunityId = membership.data?.community_id || null;
  if (!actorCommunityId && actorProfile.data.is_root) {
    const community = await service.from('communities').select('id').eq('state', 'Activo').order('created_at').limit(1).maybeSingle();
    if (community.error) return jsonResponse(400, { error: community.error.message }, origin);
    actorCommunityId = community.data?.id || null;
  }
  if (!actorCommunityId) return jsonResponse(400, { error: 'No se pudo determinar la comunidad activa.' }, origin);

  let input: { action?: string; payload?: Record<string, unknown> };
  try { input = await request.json(); } catch { return jsonResponse(400, { error: 'Solicitud no válida' }, origin); }
  const action = String(input.action || '');
  const payload = payloadObject(input.payload);

  try {

    if (action === 'backupExport') {
      if (!actorProfile.data?.is_root) {
        return jsonResponse(
          403,
          { error: 'Acceso exclusivo ROOT.' },
          origin
        );
      }

      const backup = await buildBackupExport(service);

      return jsonResponse(
        200,
        backup,
        origin
      );
    }


    if (action === 'systemPing') {
      if (!actorProfile.data.is_root) return jsonResponse(403, { error: 'Acceso exclusivo ROOT.' }, origin);
      return jsonResponse(200, { ok: true, checkedAt: new Date().toISOString(), service: 'parking-admin' }, origin);
    }
    if (action === 'legacyBackupStatus') {
      if (!actorProfile.data.is_root) {
        return jsonResponse(
          403,
          { error: 'Acceso exclusivo ROOT.' },
          origin
        );
      }

      const backup = await legacyBridgeRequest(
        'backup.status',
        {}
      );

      return jsonResponse(
        200,
        {
          ok: true,
          backup
        },
        origin
      );
    }

    if (action === 'legacyBackupRunNow') {
      if (!actorProfile.data.is_root) {
        return jsonResponse(
          403,
          { error: 'Acceso exclusivo ROOT.' },
          origin
        );
      }

      const backup = await legacyBridgeRequest(
        'backup.runNow',
        {}
      );

      return jsonResponse(
        200,
        {
          ok: true,
          backup
        },
        origin
      );
    }

    if (action === 'legacyBridgeStatus') {
      if (!actorProfile.data.is_root) return jsonResponse(403, { error: 'Acceso exclusivo ROOT.' }, origin);
      const bridge = await legacyBridgeRequest('status', {});
      return jsonResponse(200, { ok: true, bridge }, origin);
    }
    if (action === 'legacyBridgeCommand') {
      if (!actorProfile.data.is_root) return jsonResponse(403, { error: 'Acceso exclusivo ROOT.' }, origin);
      const domain = String(payload.domain || '');
      const command = String(payload.command || '');
      if (!['mail', 'documents'].includes(domain) || !command) throw new Error('Comando bridge no válido.');
      const queued = await legacyBridgeRequest('command.enqueue', { domain, command, args: payloadObject(payload.args), requestedBy: actorAuditEmail });
      await service.from('audit_log').insert({
        community_id: actorCommunityId,
        actor_user_id: actorId,
        user_id: actorId,
        actor_email: actorAuditEmail,
        action: 'LEGACY_BRIDGE_COMMAND',
        entity: domain === 'mail' ? 'CORREO' : 'DOCUMENTOS',
        entity_id: String(queued?.id || ''),
        observations: `Comando heredado solicitado desde Sistema: ${domain}.${command}`,
        source: 'APPLICATION'
      });
      return jsonResponse(200, { ok: true, command: queued }, origin);
    }
    if (action === 'legacyBridgeCommandStatus') {
      if (!actorProfile.data.is_root) return jsonResponse(403, { error: 'Acceso exclusivo ROOT.' }, origin);
      const id = String(payload.id || '');
      if (!id) throw new Error('ID de comando no indicado.');
      const status = await legacyBridgeRequest('command.status', { id });
      return jsonResponse(200, { ok: true, command: status }, origin);
    }
    if (action === 'previewOwnerImport' || action === 'applyOwnerImport') {
      const rows = Array.isArray(payload.rows) ? payload.rows as AnyRow[] : [];
      if (!rows.length) throw new Error('El archivo no contiene filas para importar.');
      if (rows.length > 500) throw new Error('El archivo supera el máximo de 500 filas.');
      const createMissingHousing = Boolean(payload.createMissingHousing);
      const snapshot = await ownerImportSnapshot(service, actorCommunityId);
      const preview = buildOwnerPreview(rows, snapshot.housing, snapshot.users, createMissingHousing);
      if (action === 'previewOwnerImport') return jsonResponse(200, preview, origin);
      if (preview.errorCount) throw new Error(`La importación tiene ${preview.errorCount} fila(s) con errores. Corrige el archivo y vuelve a previsualizarlo.`);

      const profileByEmail = new Map<string, AnyRow>(snapshot.users.map((u: AnyRow) => [String(u.email || '').toLowerCase(), u]));
      const userIdByEmail = new Map<string, string>();
      const createdUserIds: string[] = [];
      const uniqueRows = new Map<string, AnyRow>();
      preview.rows.forEach((row: AnyRow) => { if (row.status === 'OK' && !uniqueRows.has(row.Email)) uniqueRows.set(row.Email, row); });
      let usersCreated = 0;
      let usersUpdated = 0;
      let housingCreated = 0;
      let housingAssigned = 0;
      let housingReassigned = 0;
      const auditRows: AnyRow[] = [];

      try {
        for (const [email, src] of uniqueRows.entries()) {
          const existing = profileByEmail.get(email);
          if (existing) {
            const nextRoles = rolesWithOwner(existing.roles || []);
            const changed = existing.name !== src.Propietario || existing.state !== 'Activo' || !(existing.roles || []).includes('PROPIETARIO');
            const profileUpdate = await service.from('profiles').update({ name: src.Propietario, state: 'Activo' }).eq('user_id', existing.user_id);
            if (profileUpdate.error) throw profileUpdate.error;
            const memberUpdate = await service.from('community_members').upsert({ community_id: actorCommunityId, user_id: existing.user_id, roles: nextRoles, state: 'Activo' }, { onConflict: 'community_id,user_id' });
            if (memberUpdate.error) throw memberUpdate.error;
            if (changed) usersUpdated += 1;
            userIdByEmail.set(email, existing.user_id);
            auditRows.push({ community_id: actorCommunityId, actor_user_id: actorId, user_id: actorId, actor_email: actorAuditEmail, action: 'MODIFICACION', entity: 'USUARIOS', entity_id: existing.user_id, observations: 'Importación de viviendas y propietarios en Supabase.', source: 'APPLICATION' });
          } else {
            const initialPassword = passwordValue();
            const authCreate = await service.auth.admin.createUser({
              email,
              password: initialPassword,
              email_confirm: true,
              user_metadata: { created_from: 'PARKING_OWNER_IMPORT', password_delivery_pending: true }
            });
            if (authCreate.error || !authCreate.data.user) throw authCreate.error || new Error(`No se pudo crear el usuario ${email}.`);
            const userId = authCreate.data.user.id;
            createdUserIds.push(userId);
            const profileUpsert = await service.from('profiles').upsert({ user_id: userId, email, name: src.Propietario, state: 'Activo', is_root: false }, { onConflict: 'user_id' });
            if (profileUpsert.error) throw profileUpsert.error;
            const memberUpsert = await service.from('community_members').upsert({ community_id: actorCommunityId, user_id: userId, roles: ['PROPIETARIO'], state: 'Activo' }, { onConflict: 'community_id,user_id' });
            if (memberUpsert.error) throw memberUpsert.error;
            userIdByEmail.set(email, userId);
            usersCreated += 1;
            auditRows.push({ community_id: actorCommunityId, actor_user_id: actorId, user_id: actorId, actor_email: actorAuditEmail, action: 'ALTA', entity: 'USUARIOS', entity_id: userId, observations: 'Alta por importación de viviendas y propietarios. Acceso inicial pendiente de entrega segura.', source: 'APPLICATION' });
          }
        }

        for (const src of preview.rows as AnyRow[]) {
          const userId = userIdByEmail.get(src.Email);
          if (!userId) throw new Error(`No se pudo resolver el propietario ${src.Email}.`);
          if (src.createHousing) {
            const suppliedId = String(src.ID_Vivienda || '');
            const newId = uuidPattern.test(suppliedId) ? suppliedId : crypto.randomUUID();
            const legacyId = suppliedId && !uuidPattern.test(suppliedId) ? suppliedId : null;
            const inserted = await service.from('dwellings').insert({
              id: newId,
              community_id: actorCommunityId,
              legacy_id: legacyId,
              block: src.Bloque,
              floor: src.Planta,
              apartment: src.Apartamento,
              display_name: src.Vivienda,
              responsible_user_id: userId,
              state: src.Estado === 'Inactiva' ? 'Inactivo' : 'Activo',
              observations: src.Observaciones || ''
            });
            if (inserted.error) throw inserted.error;
            housingCreated += 1;
            auditRows.push({ community_id: actorCommunityId, actor_user_id: actorId, user_id: actorId, actor_email: actorAuditEmail, action: 'ALTA', entity: 'VIVIENDAS', entity_id: newId, observations: 'Alta por importación de viviendas y propietarios.', source: 'APPLICATION' });
          } else {
            const before = snapshot.housing.find((h: AnyRow) => h.id === src.ID_Vivienda);
            if (!before) throw new Error(`No se encontró la vivienda ${src.Vivienda} durante la importación.`);
            if (before.responsible_user_id !== userId) {
              const updated = await service.from('dwellings').update({ responsible_user_id: userId }).eq('id', before.id).eq('community_id', actorCommunityId);
              if (updated.error) throw updated.error;
              if (before.responsible_user_id) housingReassigned += 1; else housingAssigned += 1;
              auditRows.push({ community_id: actorCommunityId, actor_user_id: actorId, user_id: actorId, actor_email: actorAuditEmail, action: 'MODIFICACION', entity: 'VIVIENDAS', entity_id: before.id, field: 'Responsable', previous_value: before.responsible_user_id || '', new_value: userId, observations: 'Importación de viviendas y propietarios.', source: 'APPLICATION' });
            }
          }
        }

        if (auditRows.length) {
          const audit = await service.from('audit_log').insert(auditRows);
          if (audit.error) throw audit.error;
        }
      } catch (error) {
        for (const userId of createdUserIds) await service.auth.admin.deleteUser(userId).catch(() => undefined);
        throw error;
      }

      return jsonResponse(200, {
        ok: true,
        totalRows: preview.total,
        uniqueUsers: preview.uniqueUsers,
        usersCreated,
        usersUpdated,
        housingCreated,
        housingAssigned,
        housingReassigned,
        welcomeEmailsQueued: 0,
        usersPendingAccess: usersCreated,
        note: usersCreated ? 'Los usuarios nuevos se crearon sin envío de correo en preproducción; establece o entrega su acceso de forma segura antes de producción.' : ''
      }, origin);
    }

    if (action === 'saveUser') {
      const email = String(payload.Email || '').trim().toLowerCase();
      const name = String(payload.Nombre || '').trim();
      const state = String(payload.Estado || 'Activo') === 'Inactivo' ? 'Inactivo' : 'Activo';
      const roles = normalizedRoles(payload.Rol);
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Email no válido.');
      if (!name) throw new Error('El nombre es obligatorio.');

      let userId = String(payload.ID_Usuario || '');
      let created = false;
      if (userId) {
        const target = await service.from('profiles').select('user_id,is_root').eq('user_id', userId).single();
        if (target.error) throw target.error;
        if (target.data.is_root) throw new Error('ROOT no puede modificarse desde Administración.');
        const authUpdate = await service.auth.admin.updateUserById(userId, { email, email_confirm: true });
        if (authUpdate.error) throw authUpdate.error;
      } else {
        const redirectTo = String(payload.AccessRedirectTo || '').trim();
        if (!redirectTo) throw new Error('No se indico la URL de activacion del usuario.');

        const authInvite = await service.auth.admin.inviteUserByEmail(
          email,
          {
            redirectTo,
            data: {
              name,
              migration_pending: false,
              created_from: 'PARKING_APP'
            }
          }
        );

        if (authInvite.error || !authInvite.data.user) {
          throw authInvite.error || new Error('No se pudo invitar al usuario.');
        }

        userId = authInvite.data.user.id;
        created = true;
      }

      const profile = await service.from('profiles').upsert({ user_id: userId, email, name, state, is_root: false }, { onConflict: 'user_id' });
      if (profile.error) {
        if (created) await service.auth.admin.deleteUser(userId);
        throw profile.error;
      }
      const member = await service.from('community_members').upsert({ community_id: actorCommunityId, user_id: userId, roles, state }, { onConflict: 'community_id,user_id' });
      if (member.error) throw member.error;
      await service.from('audit_log').insert({ community_id: actorCommunityId, actor_user_id: actorId, user_id: actorId, actor_email: actorAuditEmail, action: created ? 'ALTA' : 'MODIFICACION', entity: 'USUARIOS', entity_id: userId, observations: 'Gestión de usuario desde preproducción Supabase.', source: 'APPLICATION' });
      return jsonResponse(200, { ok: true, user_id: userId, created, inviteEmailSent: created, accessDeliveryPending: false }, origin);
    }

    const targetId = String(payload.id || payload.ID_Usuario || '');
    if (!targetId) throw new Error('Usuario no indicado.');
    const target = await service.from('profiles').select('user_id,email,is_root').eq('user_id', targetId).single();
    if (target.error) throw target.error;
    if (target.data.is_root) throw new Error('La identidad ROOT se gestiona únicamente mediante el procedimiento técnico seguro.');

    if (action === 'sendPasswordReset') {
      const redirectTo = String(payload.redirectTo || '').trim();
      if (!redirectTo) throw new Error('No se indicó la URL de recuperación.');

      const email = String(target.data.email || '').trim().toLowerCase();
      if (!email) throw new Error('El usuario no tiene un email válido.');

      const reset = await authClient.auth.resetPasswordForEmail(email, { redirectTo });
      if (reset.error) throw reset.error;

      await service.from('audit_log').insert({
        community_id: actorCommunityId,
        actor_user_id: actorId,
        user_id: actorId,
        actor_email: actorAuditEmail,
        action: 'PASSWORD_RESET_SENT',
        entity: 'USUARIOS',
        entity_id: targetId,
        observations: 'Administración envió un enlace seguro para crear/restablecer la contraseña mediante Supabase Auth.',
        source: 'APPLICATION'
      });

      return jsonResponse(200, { ok: true, email, resetEmailSent: true }, origin);
    }

    if (action === 'generateTemporaryPassword') {
      const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      const numbers = '23456789';
      const pool = letters + numbers;

      const randomIndex = (max: number) => {
        const bytes = new Uint32Array(1);
        crypto.getRandomValues(bytes);
        return bytes[0] % max;
      };

      let password =
        letters[randomIndex(letters.length)] +
        numbers[randomIndex(numbers.length)];

      while (password.length < 12) {
        password += pool[randomIndex(pool.length)];
      }

      const chars = password.split('');
      for (let i = chars.length - 1; i > 0; i--) {
        const j = randomIndex(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
      }
      password = chars.join('');

      if (
        password.length < 8 ||
        !/[A-Za-z]/.test(password) ||
        !/\d/.test(password)
      ) {
        throw new Error('No se pudo generar una contraseña temporal válida.');
      }

      const updated = await service.auth.admin.updateUserById(
        targetId,
        { password }
      );

      if (updated.error) throw updated.error;

      await service.from('audit_log').insert({
        community_id: actorCommunityId,
        actor_user_id: actorId,
        user_id: actorId,
        actor_email: actorAuditEmail,
        action: 'PASSWORD_TEMPORARY_GENERATED',
        entity: 'USUARIOS',
        entity_id: targetId,
        observations: 'Administración generó una contraseña temporal como acceso asistido. La contraseña se muestra una sola vez y no se envía por correo.',
        source: 'APPLICATION'
      });

      return jsonResponse(
        200,
        {
          ok: true,
          temporaryPassword: password,
          email: target.data.email
        },
        origin
      );
    }

    if (action === 'closeSessions') {
      const invalidated = await service.from('profiles').update({ auth_invalid_before: new Date(Date.now() - 1000).toISOString() }).eq('user_id', targetId);
      if (invalidated.error) throw invalidated.error;
      await service.from('audit_log').insert({ community_id: actorCommunityId, actor_user_id: actorId, user_id: actorId, actor_email: actorAuditEmail, action: 'CLOSE_SESSIONS_REQUESTED', entity: 'USUARIOS', entity_id: targetId, observations: 'Se marcó la cuenta para reautenticación global.', source: 'APPLICATION' });
      return jsonResponse(200, { ok: true }, origin);
    }
    throw new Error('Acción no soportada.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo completar la operación.';
    return jsonResponse(400, { error: message }, origin);
  }
});

function payloadObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}
