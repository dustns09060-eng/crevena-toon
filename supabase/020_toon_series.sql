-- ============================================================
-- 020_toon_series.sql
-- 연재형 Crevena Toon을 위한 Series(시리즈) 도입.
--
-- 019 실행 이후에만 적용 가능. 001~019는 이 파일에서 수정하지 않는다.
--
-- 설계 결정:
-- - toon_characters는 그대로 "user 소유의 전역 캐릭터 풀"로 남긴다
--   (요청사항: 캐릭터를 특정 프로젝트/시리즈에 종속시키지 않는다).
--   toon_characters에 series_id 컬럼을 직접 추가하지 않고,
--   toon_series_characters라는 별도 N:M 조인 테이블을 둔다 —
--   한 캐릭터(예: 엄마)가 나중에 다른 시리즈에서도 재사용될 수 있는
--   가능성을 열어두기 위함이다.
-- - toon_projects.series_id는 nullable이다: 기존 프로젝트(레거시)는
--   series_id = null인 "독립 프로젝트"로 남고, 이 컬럼을 추가해도
--   기존 동작에는 전혀 영향이 없다.
-- - toon_project_characters(기존 테이블)는 그대로 "Episode Characters"
--   역할을 계속 맡는다 — 새 테이블로 대체하지 않는다.
-- ============================================================

create table if not exists toon_series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  title text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_toon_series_updated_at on toon_series;
create trigger trg_toon_series_updated_at
  before update on toon_series
  for each row execute function toon_set_updated_at();

-- 006_toon_user_defaults.sql과 동일한 패턴 — 클라이언트가 INSERT 시
-- user_id를 생략해도 로그인한 사용자로 자동 채워지게 한다.
alter table toon_series alter column user_id set default auth.uid();

-- ------------------------------------------------------------
-- toon_series_characters — Series <-> Character N:M
-- (한 캐릭터가 여러 시리즈에 속할 수 있고, 한 시리즈에 여러 캐릭터가
--  속할 수 있다. toon_project_characters와 동일한 조인 테이블 패턴.)
-- ------------------------------------------------------------
create table if not exists toon_series_characters (
  series_id uuid not null references toon_series(id) on delete cascade,
  character_id uuid not null references toon_characters(id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (series_id, character_id)
);

alter table toon_projects add column if not exists series_id uuid references toon_series(id) on delete set null;

-- toon_projects의 기존 INSERT/UPDATE 정책(002_toon_rls.sql)은
-- series_id 컬럼이 생기기 전에 작성되어 "내 프로젝트에 남의 시리즈를
-- 연결"하는 경로를 막지 못한다. 002는 수정하지 않고, 여기서 같은
-- 이름의 정책을 교체(drop 후 재생성)해 series_id 소유권 검사를 추가한다.
drop policy if exists toon_projects_insert_own on toon_projects;
create policy toon_projects_insert_own
  on toon_projects for insert
  with check (
    auth.uid() = user_id
    and (
      series_id is null
      or exists (
        select 1 from toon_series s
        where s.id = toon_projects.series_id
          and s.user_id = auth.uid()
      )
    )
  );

drop policy if exists toon_projects_update_own on toon_projects;
create policy toon_projects_update_own
  on toon_projects for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (
      series_id is null
      or exists (
        select 1 from toon_series s
        where s.id = toon_projects.series_id
          and s.user_id = auth.uid()
      )
    )
  );

-- ------------------------------------------------------------
-- RLS — toon_characters와 동일한 user ownership 원칙.
-- ------------------------------------------------------------
alter table toon_series enable row level security;

create policy toon_series_select_own
  on toon_series for select
  using (auth.uid() = user_id);

create policy toon_series_insert_own
  on toon_series for insert
  with check (auth.uid() = user_id);

create policy toon_series_update_own
  on toon_series for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy toon_series_delete_own
  on toon_series for delete
  using (auth.uid() = user_id);

-- toon_series_characters — 부모 두 개(toon_series, toon_characters) 모두
-- 소유권을 확인한다. toon_project_characters(002_toon_rls.sql)와 동일한
-- 이유: 내 시리즈에 남의 캐릭터를 연결하려는 시도를 막기 위함.
alter table toon_series_characters enable row level security;

create policy toon_series_characters_select_own
  on toon_series_characters for select
  using (
    exists (
      select 1 from toon_series s
      where s.id = toon_series_characters.series_id
        and s.user_id = auth.uid()
    )
  );

create policy toon_series_characters_insert_own
  on toon_series_characters for insert
  with check (
    exists (
      select 1 from toon_series s
      where s.id = toon_series_characters.series_id
        and s.user_id = auth.uid()
    )
    and exists (
      select 1 from toon_characters c
      where c.id = toon_series_characters.character_id
        and c.user_id = auth.uid()
    )
  );

create policy toon_series_characters_delete_own
  on toon_series_characters for delete
  using (
    exists (
      select 1 from toon_series s
      where s.id = toon_series_characters.series_id
        and s.user_id = auth.uid()
    )
  );
