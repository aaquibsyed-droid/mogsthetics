-- NutriLens AI — Supabase Storage bucket for meal images.
-- Objects live at "<user_id>/<object>.jpg" in a PRIVATE bucket. Users can only
-- read/write/delete objects inside their own folder; images are delivered via
-- short-lived signed URLs. Skipped automatically where the storage schema does
-- not exist (e.g. the local PGlite development database).

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present; skipping storage migration';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('meal-images', 'meal-images', false, 8388608, array['image/jpeg', 'image/webp', 'image/png'])
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  execute $p$
    create policy "meal images: owner can read" on storage.objects for select to authenticated
      using (bucket_id = 'meal-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
  $p$;
  execute $p$
    create policy "meal images: owner can upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'meal-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
  $p$;
  execute $p$
    create policy "meal images: owner can delete" on storage.objects for delete to authenticated
      using (bucket_id = 'meal-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
  $p$;
end $$;
