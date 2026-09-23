-- ============================================================
-- verify_toon_rls.sql (READ-ONLY)
--
-- 002 적용 후 RLS가 의도대로 켜져 있고 정책이 생성됐는지 확인하는
-- 조회 전용 스크립트. INSERT/UPDATE/DELETE/DDL을 포함하지 않는다.
-- ============================================================

-- 1) 모든 toon_ 테이블에 RLS가 켜져 있는지 확인 (rowsecurity = true 이어야 함)
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relname like 'toon_%'
  and relkind = 'r'
order by relname;

-- 2) 정책 목록 및 조건 확인
select
  schemaname,
  tablename,
  policyname,
  cmd as command,
  qual as using_expression,
  with_check as with_check_expression
from pg_policies
where tablename like 'toon_%'
order by tablename, cmd;

-- 3) 테이블별 정책 개수 (select/insert/update/delete 커버리지 육안 확인용)
select tablename, cmd, count(*) as policy_count
from pg_policies
where tablename like 'toon_%'
group by tablename, cmd
order by tablename, cmd;

-- 4) RLS가 꺼져 있는 toon_ 테이블이 있는지(있으면 안 됨) 확인하는 안전장치 쿼리
select relname as table_without_rls
from pg_class
where relname like 'toon_%'
  and relkind = 'r'
  and relrowsecurity = false;
-- 위 쿼리 결과가 0 rows 여야 정상.
