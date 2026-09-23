-- ============================================================
-- 003_toon_indexes.sql
-- AI 인스타툰 메이커 — 인덱스
--
-- 001, 002 실행 이후에만 적용 가능. 사용자 승인 전까지 실행하지 않는다.
-- 요구된 조회 패턴에 필요한 인덱스만 추가한다 (남발 금지).
-- ============================================================

-- user_id별 캐릭터 목록 (최신순)
create index if not exists ix_toon_characters_user_created
  on toon_characters (user_id, created_at desc);

-- user_id별 최근 프로젝트
create index if not exists ix_toon_projects_user_created
  on toon_projects (user_id, created_at desc);

-- (project_id, panel_number) 순서 조회는 이미 001의
-- UNIQUE (project_id, panel_number) 제약이 인덱스 역할을 겸하므로 추가 생략.

-- 캐릭터별 참조 이미지 정렬 조회
create index if not exists ix_toon_character_references_char_sort
  on toon_character_references (character_id, sort_order);

-- 프로젝트별 캐릭터 역방향 조회 (캐릭터 삭제/재사용 현황 확인용)
create index if not exists ix_toon_project_characters_character
  on toon_project_characters (character_id);

-- project_id별 generation logs (최신순)
create index if not exists ix_toon_generations_project_created
  on toon_generations (project_id, created_at desc)
  where project_id is not null;

-- user_id별 AI 사용량 조회 (최신순)
create index if not exists ix_toon_generations_user_created
  on toon_generations (user_id, created_at desc);

-- panel_id로 특정 컷의 생성 이력 조회
create index if not exists ix_toon_generations_panel
  on toon_generations (panel_id)
  where panel_id is not null;
