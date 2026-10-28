-- Create the tenant shell only. No production users or operational data are imported here.
insert into public.communities (slug, name, short_description, state)
values (
  'flores-de-riviera',
  'Urbanización Flores de Riviera',
  'Parking Comunidad',
  'Activo'
)
on conflict (slug) do update
set name = excluded.name,
    short_description = excluded.short_description,
    state = excluded.state,
    updated_at = now();
