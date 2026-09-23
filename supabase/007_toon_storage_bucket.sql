-- ============================================================
-- 007_toon_storage_bucket.sql
-- STEP 2 — toon-references Storage Bucket 생성.
--
-- 사용자 승인 전까지 Production에 실행하지 않는다.
-- crevena-toon-staging 등 별도 스테이징 프로젝트에만 적용한다.
--
-- 경로 규칙: {user_id}/{character_id}/{uuid}.{ext}
-- 원본 파일명을 경로에 쓰지 않는다 (lib/characters/photoValidation.ts
-- buildReferenceStoragePath 참조).
--
-- character-sheet/panel/export 등 다른 버킷은 이번 STEP에서 만들지 않는다.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('toon-references', 'toon-references', false)
on conflict (id) do nothing;
