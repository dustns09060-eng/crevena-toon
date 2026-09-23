-- ============================================================
-- 017_toon_panels_storage.sql
-- STEP 6 — toon-panels Storage Bucket + RLS.
--
-- 사용자 승인 전까지 Production에 실행하지 않는다.
-- crevena-toon-staging 등 별도 스테이징 프로젝트에만 적용한다.
--
-- 경로: {user_id}/{project_id}/raw/{panel_number}/{generation_id}.png
-- raw AI 이미지는 절대 덮어쓰지 않는다 — 재생성은 새 generation_id로
-- 새 경로에 저장한다. STEP 7의 말풍선 합성 결과(final)는 이번 STEP
-- 에서 만들지 않는다.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('toon-panels', 'toon-panels', false)
on conflict (id) do nothing;

create policy toon_panels_storage_select_own
  on storage.objects for select
  using (
    bucket_id = 'toon-panels'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy toon_panels_storage_insert_own
  on storage.objects for insert
  with check (
    bucket_id = 'toon-panels'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy toon_panels_storage_update_own
  on storage.objects for update
  using (
    bucket_id = 'toon-panels'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'toon-panels'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy toon_panels_storage_delete_own
  on storage.objects for delete
  using (
    bucket_id = 'toon-panels'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
