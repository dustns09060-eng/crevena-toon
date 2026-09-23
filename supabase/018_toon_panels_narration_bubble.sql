-- ============================================================
-- 018_toon_panels_narration_bubble.sql
-- STEP 7 §6, §11 — 내레이션 박스(위치/크기/폰트 크기)를 대사 말풍선과
-- 별도 구조로 저장하기 위한 컬럼 추가.
--
-- 001~017 실행 이후에만 적용 가능. 001~017은 이 파일에서 수정하지 않는다.
--
-- 설계 결정:
-- - dialogue[].bubble(JSONB)에 font_size/style 필드를 추가로 넣는 것은
--   스키마 변경 없이(그냥 JSONB에 optional 키 추가) TypeScript/zod
--   레벨에서만 확장하면 되므로 마이그레이션이 필요 없다
--   (005의 chk_toon_panels_dialogue_is_array는 배열 여부만 검사한다).
-- - 다만 narration은 지금까지 순수 text 컬�럼이었고 위치/크기 정보를
--   저장할 곳이 없었으므로, 이 컬럼만 새로 추가한다.
-- - nullable JSONB로 추가한다: 기존 행은 narration_bubble이 없어도
--   에디터가 진입 시 기본 배치를 계산해서 보여주면 되므로(§3),
--   NOT NULL + DEFAULT 강제나 백필이 불필요하다.
-- ============================================================

alter table toon_panels
  add column if not exists narration_bubble jsonb;

comment on column toon_panels.narration_bubble is
  'STEP 7 — 내레이션 박스의 x/y/width/height(0~1 normalized)와 font_size. null이면 에디터가 기본 배치를 계산한다.';
