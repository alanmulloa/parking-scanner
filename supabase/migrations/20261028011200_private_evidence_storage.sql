-- Private evidence/document storage. No public permanent URLs are used.

alter table public.incident_followups
  add constraint incident_followups_id_community_unique unique (id, community_id);

create table if not exists public.file_objects (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  incident_id uuid,
  followup_id uuid,
  bucket_id text not null default 'parking-private',
  object_path text not null,
  original_name text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  legacy_url text,
  created_by uuid,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (bucket_id, object_path),
  check (incident_id is not null or followup_id is not null),
  constraint file_objects_incident_community_fk
    foreign key (incident_id, community_id)
    references public.incidents(id, community_id)
    on delete cascade,
  constraint file_objects_followup_community_fk
    foreign key (followup_id, community_id)
    references public.incident_followups(id, community_id)
    on delete cascade,
  constraint file_objects_creator_membership_fk
    foreign key (community_id, created_by)
    references public.community_members(community_id, user_id)
    on delete set null (created_by)
);

create index if not exists file_objects_incident_idx on public.file_objects(incident_id);
create index if not exists file_objects_followup_idx on public.file_objects(followup_id);
create index if not exists file_objects_community_time_idx on public.file_objects(community_id, created_at desc);

alter table public.file_objects enable row level security;
revoke all on public.file_objects from anon, authenticated;
grant select, insert, delete on public.file_objects to authenticated;

create policy file_objects_select on public.file_objects
for select to authenticated
using (
  private.has_community_role(community_id, array['ADMIN','CONTROL']::text[])
  or exists (
    select 1 from public.incidents i
     where i.id = incident_id and i.dwelling_id is not null and private.owns_dwelling(i.dwelling_id)
  )
  or exists (
    select 1
      from public.incident_followups f
      join public.incidents i on i.id = f.incident_id
     where f.id = followup_id and i.dwelling_id is not null and private.owns_dwelling(i.dwelling_id)
  )
);

create policy file_objects_insert_staff on public.file_objects
for insert to authenticated
with check (
  private.has_community_role(community_id, array['ADMIN','CONTROL']::text[])
  and (created_by is null or created_by = (select auth.uid()) or private.has_community_role(community_id, array['ADMIN']::text[]))
);

create policy file_objects_delete_admin on public.file_objects
for delete to authenticated
using (private.has_community_role(community_id, array['ADMIN']::text[]));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'parking-private',
  'parking-private',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','application/pdf']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Object paths must begin with the community UUID: <community>/<incident>/<file>.
create policy parking_private_objects_select on storage.objects
for select to authenticated
using (
  bucket_id = 'parking-private'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and exists (
    select 1 from public.file_objects fo
     where fo.bucket_id = storage.objects.bucket_id
       and fo.object_path = storage.objects.name
       and fo.community_id = ((storage.foldername(storage.objects.name))[1])::uuid
  )
);

create policy parking_private_objects_insert_staff on storage.objects
for insert to authenticated
with check (
  bucket_id = 'parking-private'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and private.has_community_role(((storage.foldername(name))[1])::uuid, array['ADMIN','CONTROL']::text[])
);

create policy parking_private_objects_update_staff on storage.objects
for update to authenticated
using (
  bucket_id = 'parking-private'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and private.has_community_role(((storage.foldername(name))[1])::uuid, array['ADMIN','CONTROL']::text[])
)
with check (
  bucket_id = 'parking-private'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and private.has_community_role(((storage.foldername(name))[1])::uuid, array['ADMIN','CONTROL']::text[])
);

create policy parking_private_objects_delete_admin on storage.objects
for delete to authenticated
using (
  bucket_id = 'parking-private'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and private.has_community_role(((storage.foldername(name))[1])::uuid, array['ADMIN']::text[])
);
