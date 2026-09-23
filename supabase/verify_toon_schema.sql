-- ============================================================
-- verify_toon_schema.sql (READ-ONLY)
--
-- 001/003 적용 후 스키마가 의도대로 생성됐는지 확인하는 조회 전용
-- 스크립트. INSERT/UPDATE/DELETE/DDL을 포함하지 않는다.
-- ============================================================

-- 1) 테이블 존재 확인
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name like 'toon_%'
order by table_name;

-- 2) 컬럼 구조 확인
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name like 'toon_%'
order by table_name, ordinal_position;

-- 3) 제약조건 확인 (PK/FK/UNIQUE/CHECK)
select
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
  and tc.table_schema = kcu.table_schema
where tc.table_schema = 'public'
  and tc.table_name like 'toon_%'
order by tc.table_name, tc.constraint_type, tc.constraint_name;

-- 4) panel_count CHECK 제약이 (6,8,10)만 허용하는지 확인
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'toon_projects'::regclass
  and contype = 'c';

-- 5) toon_panels 의 (project_id, panel_number) UNIQUE 제약 확인
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'toon_panels'::regclass
  and contype = 'u';

-- 6) 인덱스 목록 확인
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename like 'toon_%'
order by tablename, indexname;

-- 7) updated_at 트리거 확인
select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where event_object_table like 'toon_%'
order by event_object_table;
