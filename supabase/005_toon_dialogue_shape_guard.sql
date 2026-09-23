-- ============================================================
-- 005_toon_dialogue_shape_guard.sql
-- STEP 1.5 §6 — dialogue JSONB에 대한 최소한의 DB 레벨 방어.
--
-- 001~004 실행 이후에만 적용 가능. 사용자 승인 전까지 실행하지 않는다.
--
-- 설계 결정 (자세한 이유는 STEP 1.5 보고서 참조):
-- - bubble 좌표 범위(0<=x<=1, x+width<=1 등)와 character_id가 실제
--   프로젝트에 연결된 캐릭터인지 같은 세부 검증은 TypeScript(zod)
--   레벨에서 수행한다 (src/db/validation.ts). 복잡한 PL/pgSQL 반복문으로
--   JSONB 배열 원소를 순회하며 검증하면 유지보수 비용이 높고 에러
--   메시지도 클라이언트에 전달하기 어렵다.
-- - 다만 "dialogue가 최상위에서 JSON 배열이어야 한다"는 형태(shape)
--   검증은 비용이 거의 없고, 애플리케이션을 거치지 않은 직접 SQL
--   조작으로부터도 데이터 무결성을 지켜주므로 CHECK 제약으로 추가한다.
-- ============================================================

alter table toon_panels
  add constraint chk_toon_panels_dialogue_is_array
  check (jsonb_typeof(dialogue) = 'array');
