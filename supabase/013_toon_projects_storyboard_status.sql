-- ============================================================
-- 013_toon_projects_storyboard_status.sql
-- STEP 5 — 스토리보드 draft -> storyboard -> confirmed 워크플로우를
-- 위해 toon_projects.status에 'confirmed'를 허용하고, AI가 생성한
-- 스토리 요약을 보존할 컬럼을 추가한다.
--
-- 001~012 실행 이후에만 적용 가능. 사용자 승인 전까지 Production에
-- 실행하지 않는다. 기존 마이그레이션 파일(001~012)은 수정하지 않는다.
--
-- 'confirmed' 상태가 되기 전에는 애플리케이션 레벨에서 STEP 6 이미지
-- 생성 진입을 막는다(이번 STEP에서는 버튼을 비활성 상태로만 둔다).
-- ============================================================

alter table toon_projects drop constraint if exists toon_projects_status_check;
alter table toon_projects add constraint toon_projects_status_check
  check (status in ('draft', 'storyboard', 'confirmed', 'generating', 'completed', 'failed'));

alter table toon_projects add column if not exists story_summary text;
