(() => {
  const cfg = window.SUPABASE_POC_CONFIG;

  if (!cfg?.url || !cfg?.publishableKey ||
      cfg.publishableKey === 'PEGAR_AQUI_PUBLISHABLE_KEY') {
    throw new Error('Falta configurar la Publishable Key de Supabase.');
  }

  if (!window.supabase?.createClient) {
    throw new Error('No se pudo cargar supabase-js.');
  }

  const sb = window.supabase.createClient(
    cfg.url,
    cfg.publishableKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  window.parkingSupabase = sb;

  const POC_SETTINGS = {
    NombreOficial: 'Urbanización Flores de Riviera',
    NombreCorto: 'Parking Comunidad',
    Descripcion: 'Gestión de acceso y parking de la comunidad'
  };

  const originalServer = server;
  const originalDefaultViewForRole = defaultViewForRole;

  const originalField = typeof field === 'function' ? field : null;

  if (originalField) {
    field = function(f, row) {
      let html = originalField(f, row);

      // En Supabase una vivienda puede existir todavía sin propietario.
      // Solo relajamos esta validación dentro de la POC.
      if (String(f?.[2] || '') === 'owner') {
        html = html.replace(/\\srequired(?=[\\s>])/g, '');
      }

      return html;
    };
  }

  function mapHousingState(value) {
    return value === 'Activo' ? 'Activa'
      : value === 'Inactivo' ? 'Inactiva'
      : value;
  }

  async function currentContext() {
    const { data: authData, error: authError } = await sb.auth.getUser();

    if (authError || !authData?.user) {
      throw new Error('Sesión no válida. Inicia sesión nuevamente.');
    }

    const authUser = authData.user;

    const { data: profile, error: profileError } = await sb
      .from('profiles')
      .select('*')
      .eq('user_id', authUser.id)
      .single();

    if (profileError) throw profileError;

    const { data: memberships, error: membershipsError } = await sb
      .from('community_members')
      .select('*')
      .eq('user_id', authUser.id)
      .eq('state', 'Activo');

    if (membershipsError) throw membershipsError;

    const roles = [
      ...new Set(
        (memberships || []).flatMap(m => Array.isArray(m.roles) ? m.roles : [])
      )
    ];

    const user = {
      ID_Usuario: authUser.id,
      Email: profile?.email || authUser.email || '',
      Nombre:
        profile?.name ||
        profile?.full_name ||
        profile?.display_name ||
        (authUser.email || '').split('@')[0],
      Rol: roles.join(','),
      Estado: profile?.state || 'Activo',
      IsRoot: !!profile?.is_root
    };

    return {
      authUser,
      profile,
      memberships: memberships || [],
      roles,
      user
    };
  }

  async function bootstrap() {
    const ctx = await currentContext();

    if (!ctx.user.Rol && !ctx.user.IsRoot) {
      throw new Error('Tu usuario no tiene un rol activo en la comunidad.');
    }

    return {
      user: ctx.user,
      settings: POC_SETTINGS,
      provider: 'SUPABASE',
      poc: true
    };
  }

  async function profilesMap() {
    const { data, error } = await sb
      .from('profiles')
      .select('user_id,email');

    if (error) throw error;

    return new Map(
      (data || []).map(p => [p.user_id, p.email || ''])
    );
  }

  async function listHousing() {
    const [housingResult, userMap] = await Promise.all([
      sb
        .from('dwellings')
        .select('*')
        .order('block', { ascending: true })
        .order('floor', { ascending: true })
        .order('apartment', { ascending: true }),
      profilesMap()
    ]);

    if (housingResult.error) throw housingResult.error;

    return (housingResult.data || []).map(h => ({
      ID_Vivienda: h.id,
      CommunityId: h.community_id,
      Vivienda: h.display_name || '',
      Bloque: h.block || '',
      Planta: h.floor || '',
      Apartamento: h.apartment || '',
      Responsable: h.responsible_user_id
        ? (userMap.get(h.responsible_user_id) || '')
        : '',
      ResponsableUserId: h.responsible_user_id || '',
      Estado: mapHousingState(h.state),
      Observaciones: h.observations || ''
    }));
  }

  async function formOptions() {
    const housing = await listHousing();

    const { data: profiles, error } = await sb
      .from('profiles')
      .select('user_id,email,state');

    if (error) throw error;

    const owners = (profiles || []).map(p => ({
      ID_Usuario: p.user_id,
      Email: p.email || '',
      Nombre: p.email || '',
      Estado: p.state || 'Activo'
    }));

    return {
      housing,
      owners
    };
  }


  async function saveHousing(payload = {}) {
    const ctx = await currentContext();

    const membership = ctx.memberships?.[0];
    if (!membership?.community_id) {
      throw new Error('No se pudo determinar la comunidad del usuario.');
    }

    let responsibleUserId = null;

    if (payload.Responsable) {
      const { data: owner, error: ownerError } = await sb
        .from('profiles')
        .select('user_id,email')
        .eq('email', String(payload.Responsable).trim())
        .maybeSingle();

      if (ownerError) throw ownerError;

      if (!owner) {
        throw new Error('No se encontró el propietario seleccionado.');
      }

      responsibleUserId = owner.user_id;
    }

    const block = String(payload.Bloque || '').trim();
    const floor = String(payload.Planta || '').trim();
    const apartment = String(payload.Apartamento || '').trim();

    if (!block || !floor || !apartment) {
      throw new Error('Bloque, planta y apartamento son obligatorios.');
    }

    const row = {
      community_id: membership.community_id,
      block,
      floor,
      apartment,
      display_name: `Bloque ${block}, ${floor} ${apartment}`,
      responsible_user_id: responsibleUserId,
      state: payload.Estado === 'Inactiva' ? 'Inactivo' : 'Activo',
      observations: String(payload.Observaciones || '').trim()
    };

    if (payload.ID_Vivienda) {
      const { data, error } = await sb
        .from('dwellings')
        .update(row)
        .eq('id', payload.ID_Vivienda)
        .select()
        .single();

      if (error) throw error;

      return {
        ok: true,
        id: data.id,
        updated: true
      };
    }

    const { data, error } = await sb
      .from('dwellings')
      .insert(row)
      .select()
      .single();

    if (error) throw error;

    return {
      ok: true,
      id: data.id,
      created: true
    };
  }


  async function listVehicles() {
    const [
      { data: vehicles, error: vehiclesError },
      { data: periods, error: periodsError }
    ] = await Promise.all([
      sb
        .from('vehicles')
        .select('*')
        .order('habitual_plate', { ascending: true }),

      sb
        .from('temporary_periods')
        .select('*')
        .order('starts_at', { ascending: true })
    ]);

    if (vehiclesError) throw vehiclesError;
    if (periodsError) throw periodsError;

    const today = new Date().toISOString().slice(0, 10);

    function mapPeriod(p) {
      if (!p) return null;

      return {
        ID_Periodo: p.id,
        ID_Vehiculo: p.vehicle_id,
        MatriculaTemporal: p.temporary_plate,
        MatriculaTemporalNormalizada: p.normalized_temporary_plate,
        Desde: p.starts_at,
        Hasta: p.ends_at,
        Estado: p.state,
        Observaciones: p.observations || ''
      };
    }

    return (vehicles || []).map(v => {
      const ownPeriods = (periods || []).filter(
        p => p.vehicle_id === v.id && p.state === 'Activo'
      );

      const current = ownPeriods.find(
        p => p.starts_at <= today && p.ends_at >= today
      );

      const upcoming = ownPeriods
        .filter(p => p.starts_at > today)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];

      return {
        ID_Vehiculo: v.id,
        ID_Vivienda: v.dwelling_id,

        MatriculaHabitual: v.habitual_plate,
        MatriculaHabitualNormalizada: v.normalized_habitual_plate,

        Marca: v.make || v.brand || '',
        Modelo: v.model || '',
        Tipo: v.type || 'Particular',

        Slot: v.slot == null ? '' : String(v.slot),

        Estado: v.state,

        QR_Token: v.qr_token || '',
        QR_Estado: v.qr_state || '',

        Observaciones: v.observations || '',

        PeriodoTemporalActual: mapPeriod(current),
        ProximoPeriodoTemporal: mapPeriod(upcoming)
      };
    });
  }


  async function saveVehicle(payload = {}) {
    const ctx = await currentContext();
    const membership = ctx.memberships?.[0];

    if (!membership?.community_id) {
      throw new Error('No se pudo determinar la comunidad del usuario.');
    }

    const communityId = membership.community_id;
    const dwellingId = String(payload.ID_Vivienda || '').trim();

    if (!dwellingId) {
      throw new Error('Debes seleccionar una vivienda.');
    }

    const plate = String(payload.MatriculaHabitual || '')
      .trim()
      .toUpperCase();

    if (!plate) {
      throw new Error('La matrícula habitual es obligatoria.');
    }

    const type = String(payload.Tipo || 'Particular').trim();
    const isMoto = type === 'Moto';

    const rawSlot = String(payload.Slot ?? '').trim();

    let requestedSlot = null;

    if (!isMoto && rawSlot) {
      requestedSlot = Number(rawSlot);

      if (![1, 2].includes(requestedSlot)) {
        throw new Error('El slot debe ser 1 o 2.');
      }
    }

    // --------------------------------------------------------
    // Vehículo existente
    // --------------------------------------------------------

    let existing = null;

    if (payload.ID_Vehiculo) {
      const { data, error } = await sb
        .from('vehicles')
        .select('*')
        .eq('id', payload.ID_Vehiculo)
        .single();

      if (error) throw error;

      existing = data;
    }

    // --------------------------------------------------------
    // Buscar primer slot libre
    // --------------------------------------------------------

    async function firstFreeSlot(targetDwellingId, excludeVehicleId = null) {
      let query = sb
        .from('vehicles')
        .select('id,slot')
        .eq('dwelling_id', targetDwellingId)
        .not('slot', 'is', null);

      if (excludeVehicleId) {
        query = query.neq('id', excludeVehicleId);
      }

      const { data, error } = await query;

      if (error) throw error;

      const occupied = new Set(
        (data || [])
          .map(v => Number(v.slot))
          .filter(v => [1, 2].includes(v))
      );

      if (!occupied.has(1)) return 1;
      if (!occupied.has(2)) return 2;

      return null;
    }

    // --------------------------------------------------------
    // Resolver slot
    // --------------------------------------------------------

    let slot = requestedSlot;

    if (isMoto) {
      // Moto nunca utiliza slot.
      slot = null;

    } else if (!existing) {
      // ALTA:
      // si no eligieron slot, asignar primer libre.
      if (slot == null) {
        slot = await firstFreeSlot(dwellingId);
      }

    } else {
      const wasMoto = existing.type === 'Moto';

      /*
       * EDICIÓN:
       *
       * - Slot indicado -> usar exactamente ese.
       * - Slot vacío en vehículo normal -> liberar slot.
       * - Moto -> Vehículo con slot vacío -> primer libre.
       */
      if (wasMoto && !isMoto && slot == null) {
        slot = await firstFreeSlot(dwellingId, existing.id);
      }
    }

    // --------------------------------------------------------
    // Resolver QR
    // --------------------------------------------------------

    const existingHadSlot =
      existing &&
      existing.type !== 'Moto' &&
      [1, 2].includes(Number(existing.slot));

    const nowHasSlot =
      !isMoto &&
      [1, 2].includes(Number(slot));

    let qrToken = existing?.qr_token || null;
    let qrState = existing?.qr_state || null;

    if (isMoto) {
      // Moto: no aplica QR.
      qrToken = null;
      qrState = null;

    } else if (nowHasSlot) {

      if (!qrToken) {
        // Primer QR del vehículo.
        qrToken = crypto.randomUUID();
        qrState = 'Activo';

      } else if (!existingHadSlot) {
        // Antes estaba sin slot y ahora vuelve a tener uno.
        qrState = 'Activo';

      } else if (payload.QR_Estado) {
        qrState = String(payload.QR_Estado);

      } else if (!qrState) {
        qrState = 'Activo';
      }

    } else {
      // Vehículo sin slot.
      if (qrToken) {
        qrState = 'Revocado';
      } else {
        qrState = null;
      }
    }

    // --------------------------------------------------------
    // Resolver estado de negocio
    // --------------------------------------------------------

    let vehicleState = String(
      payload.Estado ||
      existing?.state ||
      'Activo'
    );

    if (isMoto) {
      // Una moto nunca está "Desasignada" por falta de slot,
      // porque los slots no aplican a motos.
      if (vehicleState === 'Desasignado') {
        vehicleState = 'Activo';
      }

    } else if (nowHasSlot) {
      // Si recibe un slot, deja de estar desasignado.
      if (vehicleState === 'Desasignado') {
        vehicleState = 'Activo';
      }

    } else {
      // Vehículo normal sin slot:
      // queda desasignado salvo que ya esté Suspendido o Baja.
      if (!['Suspendido', 'Baja'].includes(vehicleState)) {
        vehicleState = 'Desasignado';
      }
    }

    // --------------------------------------------------------
    // Payload Supabase
    // --------------------------------------------------------

    const row = {
      community_id: communityId,
      dwelling_id: dwellingId,

      habitual_plate: plate,

      make: String(payload.Marca || '').trim(),
      model: String(payload.Modelo || '').trim(),

      type,
      slot,

      state: vehicleState,

      qr_token: qrToken,
      qr_state: qrState,

      observations: String(payload.Observaciones || '').trim()
    };

    // --------------------------------------------------------
    // Guardar
    // --------------------------------------------------------

    try {

      if (existing) {
        const { data, error } = await sb
          .from('vehicles')
          .update(row)
          .eq('id', existing.id)
          .select()
          .single();

        if (error) throw error;

        console.log(
          '[Supabase POC] vehículo actualizado:',
          {
            id: data.id,
            dwelling: data.dwelling_id,
            type: data.type,
            slot: data.slot,
            qrState: data.qr_state
          }
        );

        return {
          ok: true,
          id: data.id,
          updated: true
        };
      }

      const { data, error } = await sb
        .from('vehicles')
        .insert(row)
        .select()
        .single();

      if (error) throw error;

      console.log(
        '[Supabase POC] vehículo creado:',
        {
          id: data.id,
          dwelling: data.dwelling_id,
          type: data.type,
          slot: data.slot,
          qrState: data.qr_state
        }
      );

      return {
        ok: true,
        id: data.id,
        created: true
      };

    } catch (e) {
      const msg = String(e?.message || '');
      const details = String(e?.details || '');
      const full = `${msg} ${details}`;

      if (
        full.includes('vehicles_plate_unique_per_community') ||
        full.includes('normalized_habitual_plate')
      ) {
        throw new Error(
          'Ya existe un vehículo con esa matrícula en la comunidad.'
        );
      }

      if (
        full.includes('vehicles_slot_unique') ||
        full.includes('dwelling_id, slot')
      ) {
        throw new Error(
          `El Slot ${slot} ya está ocupado en esa vivienda.`
        );
      }

      if (
        full.includes('vehicles_qr_unique_per_community') ||
        full.includes('qr_token')
      ) {
        throw new Error(
          'Ya existe ese QR en la comunidad.'
        );
      }

      throw e;
    }
  }


  function temporaryPayloadValue(payload, keys) {
    const p = payload || {};

    for (const key of keys) {
      if (p[key] !== undefined && p[key] !== null && p[key] !== '') {
        return p[key];
      }
    }

    return null;
  }

  function mapTemporaryPeriod(row) {
    if (!row) return null;

    return {
      ID_Periodo: row.id,
      ID_Temporal: row.id,

      ID_Vehiculo: row.vehicle_id,

      MatriculaTemporal: row.temporary_plate,
      MatriculaTemporalNormalizada: row.normalized_temporary_plate,

      Desde: row.starts_at,
      Hasta: row.ends_at,

      Estado: row.state,

      Observaciones: row.observations || '',

      CreatedAt: row.created_at || '',
      CreatedBy: row.created_by || ''
    };
  }

  async function listTemporaryPeriodsSupabase(payload = {}) {
    const vehicleId = temporaryPayloadValue(payload, [
      'ID_Vehiculo',
      'vehicleId',
      'vehicle_id',
      'idVehicle',
      'id'
    ]);

    let query = sb
      .from('temporary_periods')
      .select('*')
      .order('starts_at', { ascending: false });

    if (vehicleId) {
      query = query.eq('vehicle_id', vehicleId);
    }

    const { data, error } = await query;

    if (error) throw error;

    const rows = (data || []).map(mapTemporaryPeriod);

    /*
     * Compatibilidad:
     * algunas pantallas pueden esperar un array directamente;
     * otras pueden intentar data.rows o data.periods.
     */
    rows.rows = rows;
    rows.periods = rows;

    return rows;
  }

  async function saveTemporaryPeriodSupabase(payload = {}) {
    const vehicleId = temporaryPayloadValue(payload, [
      'ID_Vehiculo',
      'vehicleId',
      'vehicle_id',
      'idVehicle'
    ]);

    const periodId = temporaryPayloadValue(payload, [
      'ID_Periodo',
      'ID_Temporal',
      'periodId',
      'period_id',
      'temporaryPeriodId'
    ]);

    const temporaryPlate = String(
      temporaryPayloadValue(payload, [
        'MatriculaTemporal',
        'temporaryPlate',
        'temporary_plate',
        'matriculaTemporal',
        'matricula'
      ]) || ''
    ).trim().toUpperCase();

    const startsAt = String(
      temporaryPayloadValue(payload, [
        'Desde',
        'desde',
        'startsAt',
        'starts_at',
        'startDate',
        'fechaDesde'
      ]) || ''
    ).trim();

    const endsAt = String(
      temporaryPayloadValue(payload, [
        'Hasta',
        'hasta',
        'endsAt',
        'ends_at',
        'endDate',
        'fechaHasta'
      ]) || ''
    ).trim();

    const observations = String(
      temporaryPayloadValue(payload, [
        'Observaciones',
        'observations',
        'observacion'
      ]) || ''
    ).trim();

    if (!vehicleId) {
      throw new Error('No se pudo determinar el vehículo.');
    }

    if (!temporaryPlate) {
      throw new Error('La matrícula temporal es obligatoria.');
    }

    if (!startsAt || !endsAt) {
      throw new Error('Debes indicar las fechas Desde y Hasta.');
    }

    if (endsAt <= startsAt) {
      throw new Error(
        'La fecha Hasta debe ser posterior a la fecha Desde.'
      );
    }

    // --------------------------------------------------------
    // Recuperar vehículo / comunidad
    // --------------------------------------------------------

    const { data: vehicle, error: vehicleError } = await sb
      .from('vehicles')
      .select('id,community_id,state')
      .eq('id', vehicleId)
      .single();

    if (vehicleError) throw vehicleError;

    if (!vehicle) {
      throw new Error('Vehículo no encontrado.');
    }

    /*
     * Los períodos existentes se conservan cuando un vehículo
     * queda Suspendido, pero no se permite crear, modificar
     * ni extender períodos mientras no esté Activo.
     */
    if (vehicle.state !== 'Activo') {
      const label = vehicle.state || 'no activo';

      if (periodId) {
        throw new Error(
          `No se puede modificar el período temporal porque ` +
          `el vehículo está ${label}.`
        );
      }

      throw new Error(
        `No se puede crear un período temporal porque ` +
        `el vehículo está ${label}.`
      );
    }

    // --------------------------------------------------------
    // Evitar solapamientos
    // --------------------------------------------------------

    let overlapQuery = sb
      .from('temporary_periods')
      .select('id,temporary_plate,starts_at,ends_at,state')
      .eq('vehicle_id', vehicleId)
      .eq('state', 'Activo')
      .lte('starts_at', endsAt)
      .gte('ends_at', startsAt);

    if (periodId) {
      overlapQuery = overlapQuery.neq('id', periodId);
    }

    const { data: overlaps, error: overlapError } =
      await overlapQuery;

    if (overlapError) throw overlapError;

    if ((overlaps || []).length) {
      const x = overlaps[0];

      throw new Error(
        `Ya existe un período temporal activo (${x.temporary_plate}) ` +
        `entre ${x.starts_at} y ${x.ends_at}.`
      );
    }

    // --------------------------------------------------------
    // Usuario creador
    // --------------------------------------------------------

    const { data: authData } = await sb.auth.getUser();
    const authUserId = authData?.user?.id || null;

    const row = {
      community_id: vehicle.community_id,
      vehicle_id: vehicleId,

      temporary_plate: temporaryPlate,

      starts_at: startsAt,
      ends_at: endsAt,

      state: 'Activo',

      observations,

      created_by: authUserId
    };

    // --------------------------------------------------------
    // Editar
    // --------------------------------------------------------

    if (periodId) {
      const { data, error } = await sb
        .from('temporary_periods')
        .update(row)
        .eq('id', periodId)
        .select()
        .single();

      if (error) throw error;

      return {
        ok: true,
        updated: true,
        period: mapTemporaryPeriod(data),
        row: mapTemporaryPeriod(data)
      };
    }

    // --------------------------------------------------------
    // Crear
    // --------------------------------------------------------

    const { data, error } = await sb
      .from('temporary_periods')
      .insert(row)
      .select()
      .single();

    if (error) throw error;

    return {
      ok: true,
      created: true,
      period: mapTemporaryPeriod(data),
      row: mapTemporaryPeriod(data)
    };
  }

  async function cancelTemporaryPeriodSupabase(payload = {}) {
    const periodId = temporaryPayloadValue(payload, [
      'ID_Periodo',
      'ID_Temporal',
      'periodId',
      'period_id',
      'temporaryPeriodId',
      'id'
    ]);

    if (!periodId) {
      throw new Error('No se pudo determinar el período temporal.');
    }

    const { data, error } = await sb
      .from('temporary_periods')
      .update({
        state: 'Anulado'
      })
      .eq('id', periodId)
      .select()
      .single();

    if (error) throw error;

    return {
      ok: true,
      cancelled: true,
      period: mapTemporaryPeriod(data),
      row: mapTemporaryPeriod(data)
    };
  }

  async function supabaseAction(action, payload = {}) {
    const temporaryAction = String(action || '').toLowerCase();

    /*
     * Compatibilidad con el backend legacy.
     * Admitimos distintas variantes del nombre de acción para no
     * acoplar la POC a una única nomenclatura.
     */
    if (
      temporaryAction.includes('temporary') ||
      temporaryAction.includes('temporal')
    ) {

      if (
        temporaryAction.includes('list') ||
        temporaryAction.includes('get')
      ) {
        return listTemporaryPeriodsSupabase(payload);
      }

      if (
        temporaryAction.includes('save') ||
        temporaryAction.includes('create') ||
        temporaryAction.includes('add') ||
        temporaryAction.includes('set') ||
        temporaryAction.includes('register') ||
        temporaryAction.includes('upsert')
      ) {
        return saveTemporaryPeriodSupabase(payload);
      }

      if (
        temporaryAction.includes('cancel') ||
        temporaryAction.includes('anul') ||
        temporaryAction.includes('void') ||
        temporaryAction.includes('delete') ||
        temporaryAction.includes('remove')
      ) {
        return cancelTemporaryPeriodSupabase(payload);
      }
    }

    switch (action) {
      case 'bootstrap':
        return bootstrap();

      case 'listHousing':
        return listHousing();

      case 'managerData': {
        const kind = payload?.kind;

        if (kind === 'housing') {
          const rows = await listHousing();
          const options = await formOptions();

          return {
            rows,
            options
          };
        }

        if (kind === 'vehicles') {
          const rows = await listVehicles();
          const options = await formOptions();

          console.log('[Supabase POC] managerData vehicles:', rows);

          return {
            rows,
            options,
            requests: [],
            incidents: [],
            requestStats: {}
          };
        }

        throw new Error(
          `POC Supabase: managerData para "${kind}" todavía no fue migrado.`
        );
      }

      case 'formOptions':
        return formOptions();

      /*
       * En esta primera POC no escribimos todavía.
       */
      case 'saveVehicle':
        return saveVehicle(payload);

      case 'saveHousing':
        return saveHousing(payload);

      default:
        throw new Error(
          `POC Supabase: la acción "${action}" todavía no fue migrada.`
        );
    }
  }

  async function supabaseServer(fn, ...args) {
    if (fn === 'loginWithPassword') {
      const [email, password] = args;

      const { data, error } = await sb.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      const boot = await bootstrap();

      return {
        token: data.session?.access_token || 'supabase-session',
        user: boot.user
      };
    }

    if (fn === 'logout') {
      const { error } = await sb.auth.signOut();
      if (error) throw error;
      return true;
    }

    if (fn === 'getPublicParkingSettings') {
      return POC_SETTINGS;
    }

    if (fn === 'api') {
      const [, action, payload = {}] = args;
      return supabaseAction(action, payload);
    }

    return originalServer(fn, ...args);
  }

  /*
   * Sustituimos solamente la capa backend.
   */
  server = supabaseServer;

  /*
   * Primera pantalla de la POC:
   * ADMIN entra directamente en Viviendas.
   */
  defaultViewForRole = function(role) {
    if (role === 'ADMIN') return 'housing';
    return originalDefaultViewForRole(role);
  };

  function relaxHousingOwnerRequirement() {
    const form = document.querySelector('#edit-form');
    if (!form) return;

    const owner = form.querySelector('[name="Responsable"]');
    if (!owner) return;

    owner.required = false;
    owner.removeAttribute('required');
  }

  const pocObserver = new MutationObserver(() => {
    relaxHousingOwnerRequirement();
  });

  pocObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  relaxHousingOwnerRequirement();

  console.info('[Parking Comunidad] Supabase POC activo');
})();
