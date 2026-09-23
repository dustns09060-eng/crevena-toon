-- ============================================================
-- 012_toon_character_sheets_storage.sql
-- STEP 4 — toon-character-sheets Storage Bucket + RLS.
--
-- 사용자 승인 전까지 Production에 실행하지 않는다.
-- crevena-toon-staging 등 별도 스테이징 프로젝트에만 적용한다.
--
-- 경로: {user_id}/{character_id}/{generation_id}/sheet.png
-- (계획 문서의 sheet.webp 대신 실제 생성 모델이 반환하는 포맷을
-- 그대로 저장한다 — 별도 webp 변환 라이브러리를 추가하지 않기 위함.
-- STEP 4 보고서에 이 결정을 명시한다.)
--
-- 원본 Character Sheet는 절대 덮어쓰지 않는다 — 재생성 시
-- generation_id가 달라지므로 경로 자체가 항상 새로 생성된다.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('toon-character-sheets', 'toon-character-sheets', false)
on conflict (id) do nothing;

create policy toon_character_sheets_storage_select_own
  on storage.objects for select
  using (
    bucket_id = 'toon-character-sheets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy toon_character_sheets_storage_insert_own
  on storage.objects for insert
  with check (
    bucket_id = 'toon-character-sheets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy toon_character_sheets_storage_update_own
  on storage.objects for update
  using (
    bucket_id = 'toon-character-sheets'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'toon-character-sheets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy toon_character_sheets_storage_delete_own
  on storage.objects for delete
  using (
    bucket_id = 'toon-character-sheets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
