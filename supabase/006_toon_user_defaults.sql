-- ============================================================
-- 006_toon_user_defaults.sql
-- STEP 1.6에서 발견된 문제 개선: user_id를 직접 갖는 테이블에
-- DEFAULT auth.uid()를 추가해, PostgREST INSERT 시 클라이언트가
-- user_id를 빠뜨려도 로그인한 사용자로 자동 채워지게 한다.
--
-- 001~005 실행 이후에만 적용 가능. 사용자 승인 전까지 Production에
-- 실행하지 않는다.
--
-- 안전성:
-- - DEFAULT는 컬럼 값이 "생략"됐을 때만 적용된다. 클라이언트가 다른
--   user_id를 명시하면 여전히 그 값이 쓰이고, 기존 RLS WITH CHECK
--   (auth.uid() = user_id)가 그대로 걸러낸다 — 우회 불가능.
-- - auth.uid()는 로그인 세션(JWT)이 없으면 NULL을 반환하므로,
--   비인증 요청은 user_id가 NULL이 되어 여전히 RLS에서 차단된다.
-- - service_role은 RLS를 우회하는 role이고, 지금까지의 서버 스크립트
--   패턴처럼 user_id를 항상 명시적으로 넘기므로 이 DEFAULT의 영향을
--   받지 않는다.
-- ============================================================

alter table toon_characters alter column user_id set default auth.uid();
alter table toon_projects alter column user_id set default auth.uid();
alter table toon_generations alter column user_id set default auth.uid();
