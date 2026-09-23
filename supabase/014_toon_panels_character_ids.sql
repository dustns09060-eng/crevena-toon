-- ============================================================
-- 014_toon_panels_character_ids.sql
-- STEP 5 — 컷(panel)에 등장하는 캐릭터 목록을 저장할 컬럼 추가.
--
-- 013 실행 이후에만 적용 가능. 사용자 승인 전까지 Production에
-- 실행하지 않는다. 기존 마이그레이션 파일(001~013)은 수정하지 않는다.
--
-- 대사가 없어도(예: 조용히 반응만 하는 캐릭터) 그 컷에 등장한다는
-- 사실 자체는 STEP 6에서 어떤 Character Bible/Character Sheet를
-- 함께 참조해야 하는지 결정하는 데 필요하므로, dialogue와 별도로
-- character_ids를 둔다.
-- ============================================================

alter table toon_panels
  add column if not exists character_ids uuid[] not null default '{}';
