-- ============================================================
-- 019_toon_cover_and_panel_count_range.sql
-- 표지(Cover) 지원 + panel_count를 고정 6/8/10에서
-- "표지 포함 TOTAL 2~20장" 범위형으로 확장.
--
-- 001~018 실행 이후에만 적용 가능. 001~018은 이 파일에서 수정하지 않는다.
-- 기존 프로젝트를 파괴하지 않는 것을 최우선으로 설계했다:
--
-- - panel_count CHECK는 "집합을 넓히는" 방향(6/8/10 -> 2~20)이라
--   기존 6/8/10 값은 전부 그대로 유효하다. 기존 row UPDATE 불필요.
-- - panel_type은 not null default 'scene'이라 기존 row는 전부
--   자동으로 'scene'이 된다 — 표지가 없던 프로젝트는 계속 표지가
--   없는 상태로 남는다(마이그레이션이 가짜 표지를 만들어 넣지 않는다).
-- - cover_title/cover_subtitle/cover_title_bubble은 전부 nullable이라
--   panel_type='scene'인 기존 row에는 항상 null로 남고 어떤 코드도
--   이 값을 읽지 않는다(panel_type==='cover'일 때만 참조).
-- ============================================================

-- 1) panel_count 범위 확장: 6/8/10 고정 -> 2~20 TOTAL(표지 포함)
alter table toon_projects drop constraint if exists toon_projects_panel_count_check;
alter table toon_projects add constraint toon_projects_panel_count_check
  check (panel_count between 2 and 20);

-- 2) panel_type: 컷/표지 구분. 기본값 'scene'이라 기존 데이터는 전부 무영향.
alter table toon_panels add column if not exists panel_type text not null default 'scene';
alter table toon_panels drop constraint if exists toon_panels_panel_type_check;
alter table toon_panels add constraint toon_panels_panel_type_check
  check (panel_type in ('cover', 'scene'));

-- 3) 표지 전용 텍스트/배치. narration과 의미가 달라 별도 컬럼으로 분리한다
--    (스토리 내레이션 vs 표지 제목/부제목).
alter table toon_panels add column if not exists cover_title text;
alter table toon_panels add column if not exists cover_subtitle text;
alter table toon_panels add column if not exists cover_title_bubble jsonb;

comment on column toon_panels.panel_type is
  '컷 종류. cover는 프로젝트(에피소드)당 최대 1개, 항상 panel_number=1. scene은 본문 컷(기존 동작과 동일).';
comment on column toon_panels.cover_title is 'panel_type=cover일 때만 사용하는 표지 제목.';
comment on column toon_panels.cover_subtitle is 'panel_type=cover일 때만 사용하는 표지 부제목/짧은 문구.';
comment on column toon_panels.cover_title_bubble is
  '표지 제목의 배치(x,y,width,height,font_size, 0~1 normalized) — narration_bubble과 동일한 형태.';
