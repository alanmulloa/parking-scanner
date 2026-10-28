-- Parse the community path segment without ever casting malformed user input.
create or replace function private.storage_path_community(object_name text)
returns uuid
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when split_part(object_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then split_part(object_name, '/', 1)::uuid
    else null
  end;
$$;
revoke all on function private.storage_path_community(text) from public;
grant execute on function private.storage_path_community(text) to authenticated, service_role;

drop policy if exists parking_private_objects_select on storage.objects;
drop policy if exists parking_private_objects_insert_staff on storage.objects;
drop policy if exists parking_private_objects_update_staff on storage.objects;
drop policy if exists parking_private_objects_delete_admin on storage.objects;

create policy parking_private_objects_select on storage.objects
for select to authenticated
using (
  bucket_id = 'parking-private'
  and private.storage_path_community(name) is not null
  and exists (
    select 1 from public.file_objects fo
     where fo.bucket_id = storage.objects.bucket_id
       and fo.object_path = storage.objects.name
       and fo.community_id = private.storage_path_community(storage.objects.name)
  )
);

create policy parking_private_objects_insert_staff on storage.objects
for insert to authenticated
with check (
  bucket_id = 'parking-private'
  and private.storage_path_community(name) is not null
  and private.has_community_role(private.storage_path_community(name), array['ADMIN','CONTROL']::text[])
);

create policy parking_private_objects_update_staff on storage.objects
for update to authenticated
using (
  bucket_id = 'parking-private'
  and private.storage_path_community(name) is not null
  and private.has_community_role(private.storage_path_community(name), array['ADMIN','CONTROL']::text[])
)
with check (
  bucket_id = 'parking-private'
  and private.storage_path_community(name) is not null
  and private.has_community_role(private.storage_path_community(name), array['ADMIN','CONTROL']::text[])
);

create policy parking_private_objects_delete_admin on storage.objects
for delete to authenticated
using (
  bucket_id = 'parking-private'
  and private.storage_path_community(name) is not null
  and private.has_community_role(private.storage_path_community(name), array['ADMIN']::text[])
);
