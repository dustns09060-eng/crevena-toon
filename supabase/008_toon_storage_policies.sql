-- ============================================================
-- 008_toon_storage_policies.sql
-- STEP 2 — toon-references 버킷 Storage RLS.
--
-- 007 실행 이후에만 적용 가능. 사용자 승인 전까지 Production에
-- 실행하지 않는다.
--
-- storage.objects는 Supabase가 기본으로 RLS를 켜둔 테이블이다.
-- 경로의 첫 세그먼트(= {user_id})가 auth.uid()와 같을 때만
-- 본인 파일에 접근할 수 있도록 제한한다.
-- ============================================================

create policy toon_references_select_own
  on storage.objects for select
  using (
    bucket_id = 'toon-references'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy toon_references_insert_own
  on storage.objects for insert
  with check (
    bucket_id = 'toon-references'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy toon_references_update_own
  on storage.objects for update
  using (
    bucket_id = 'toon-references'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'toon-references'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy toon_references_delete_own
  on storage.objects for delete
  using (
    bucket_id = 'toon-references'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
