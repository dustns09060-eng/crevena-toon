-- ============================================================
-- 009_toon_character_bible_fields.sql
-- STEP 3 — AI Character Bible 분석 결과를 담기 위한 스키마 보강.
--
-- 001~008 실행 이후에만 적용 가능. 사용자 승인 전까지 Production에
-- 실행하지 않는다. 기존 마이그레이션 파일(001~008)은 수정하지 않고
-- 새 파일로만 추가한다.
--
-- 1) negative_constraints: 단일 문자열(text) -> 문자열 배열(text[])
--    "향후 promptBuilder에서 안정적으로 사용할 수 있는 구조"를 위해
--    구조화한다. STEP 2까지는 이 컬럼을 사용자 입력 폼에 노출하지
--    않아 전부 NULL 상태이므로, 기존 값을 보존하는 안전한 캐스팅으로
--    처리한다(혹시 NULL이 아닌 값이 있다면 1개짜리 배열로 감싼다).
--
-- 2) distinctive_features: 옷/헤어 등 대표 항목에 들어가지 않는
--    "그 캐릭터만의 특징적인 시각 요소"(예: 보조개, 주근깨 등 —
--    민감정보 아닌 단순 시각적 특징)를 위한 선택 컬럼 추가.
-- ============================================================

alter table toon_characters
  alter column negative_constraints type text[]
  using case
    when negative_constraints is null then null
    else array[negative_constraints]
  end;

alter table toon_characters
  add column if not exists distinctive_features text;
