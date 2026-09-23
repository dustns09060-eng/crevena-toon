-- ============================================================
-- 021_toon_locations.sql
-- Location Bible 도입 — Character(엄마/별이/달이)와 완전히 별개의
-- "장소" 개념을 추가한다. 목표는 1화뿐 아니라 2화, 3화, ..., 20화에서도
-- 같은 시리즈의 같은 집(거실/침실/주방/욕실/복도)을 재사용하는 것.
--
-- 001~020 실행 이후에만 적용 가능. 사용자 승인 및 Production 확인 전까지
-- 실행하지 않는다. 기존 마이그레이션 파일(001~020)은 수정하지 않는다.
--
-- 설계 원칙(020_toon_series.sql과 동일한 패턴을 그대로 재사용):
-- - toon_characters/toon_series_characters 패턴을 toon_locations/
--   toon_series_locations로 그대로 복제한다 — 이미 검증된 설계를
--   재사용해 리스크를 낮춘다.
-- - toon_locations는 "user 소유의 전역 장소 풀"이다(캐릭터와 동일).
--   toon_series_locations라는 별도 N:M 조인 테이블을 두어, 한 장소가
--   나중에 다른 시리즈에서도 재사용될 가능성을 열어둔다.
-- - toon_panels.location_id / time_of_day는 전부 nullable이다: 기존
--   panel(레거시)은 이 값이 없어도 지금까지와 완전히 동일하게 동작한다.
--   즉 이번 migration은 순수 추가(additive)이며 기존 데이터에 대한
--   UPDATE/DELETE를 전혀 포함하지 않는다.
-- ============================================================

-- ------------------------------------------------------------
-- toon_locations — "Location Bible" (텍스트 기준, 이미지 reference는
-- 이번 단계에서 아직 만들지 않는다).
-- ------------------------------------------------------------
create table if not exists toon_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  display_name text not null,           -- 예: "우리 집 거실" (사용자가 보는 이름)

  -- Location Bible 필드. 실사용 UX(사용자 요청)를 단순하게 유지하기 위해
  -- 사용자가 반드시 입력해야 하는 값은 display_name + visual_prompt(자유
  -- 서술 "설명") 딱 두 개뿐이다. 나머지(wall_and_floor/fixed_furniture/
  -- window_style/recurring_props/distinctive_features)는 전부 nullable인
  -- "고급 설정" — 입력하면 prompt builder가 더 구체적으로 반영하고,
  -- 비워두면 visual_prompt만으로 동작한다(Character Bible처럼 필드별
  -- 필수 입력을 요구하지 않는다).
  visual_prompt text not null,           -- 사용자가 쓰는 "설명" 그 자체(예: "회색 소파가 있고 밝은 원목 바닥, 아이보리 러그와 낮은 책장이 있는 거실")
  wall_and_floor text,                   -- 고급 설정(선택) — 벽/바닥 색상 및 마감
  fixed_furniture text,                  -- 고급 설정(선택) — 고정 가구 + 배치(소파/책장/침대/식탁 등)
  window_style text,                     -- 고급 설정(선택) — 창문 위치/스타일/커튼
  recurring_props text,                  -- 고급 설정(선택) — 반복 등장 소품(화분, 액자 등)
  distinctive_features text,             -- 고급 설정(선택) — 기타 고유 특징
  negative_constraints text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_toon_locations_updated_at on toon_locations;
create trigger trg_toon_locations_updated_at
  before update on toon_locations
  for each row execute function toon_set_updated_at();

-- 006_toon_user_defaults.sql / 020_toon_series.sql과 동일한 패턴 —
-- 클라이언트가 INSERT 시 user_id를 생략해도 로그인한 사용자로 자동 채워지게 한다.
alter table toon_locations alter column user_id set default auth.uid();

-- ------------------------------------------------------------
-- toon_series_locations — Series <-> Location N:M
-- (toon_series_characters와 완전히 동일한 패턴.)
-- ------------------------------------------------------------
create table if not exists toon_series_locations (
  series_id uuid not null references toon_series(id) on delete cascade,
  location_id uuid not null references toon_locations(id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (series_id, location_id)
);

-- ------------------------------------------------------------
-- toon_panels — location_id / time_of_day 추가(둘 다 nullable).
-- ------------------------------------------------------------
alter table toon_panels add column if not exists location_id uuid references toon_locations(id) on delete set null;
alter table toon_panels add column if not exists time_of_day text
  check (time_of_day is null or time_of_day in ('MORNING', 'DAY', 'EVENING', 'NIGHT', 'LATE_NIGHT'));

create index if not exists ix_toon_panels_location on toon_panels (location_id) where location_id is not null;
create index if not exists ix_toon_series_locations_location on toon_series_locations (location_id);

-- ------------------------------------------------------------
-- RLS — toon_characters/toon_series_characters와 동일한 원칙.
-- ------------------------------------------------------------
alter table toon_locations enable row level security;

create policy toon_locations_select_own
  on toon_locations for select
  using (auth.uid() = user_id);

create policy toon_locations_insert_own
  on toon_locations for insert
  with check (auth.uid() = user_id);

create policy toon_locations_update_own
  on toon_locations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy toon_locations_delete_own
  on toon_locations for delete
  using (auth.uid() = user_id);

-- toon_series_locations — 부모 두 개(toon_series, toon_locations) 모두
-- 소유권을 확인한다. toon_series_characters(020)와 동일한 이유: 내
-- 시리즈에 남의 장소를 연결하려는 시도를 막기 위함.
alter table toon_series_locations enable row level security;

create policy toon_series_locations_select_own
  on toon_series_locations for select
  using (
    exists (
      select 1 from toon_series s
      where s.id = toon_series_locations.series_id
        and s.user_id = auth.uid()
    )
  );

create policy toon_series_locations_insert_own
  on toon_series_locations for insert
  with check (
    exists (
      select 1 from toon_series s
      where s.id = toon_series_locations.series_id
        and s.user_id = auth.uid()
    )
    and exists (
      select 1 from toon_locations l
      where l.id = toon_series_locations.location_id
        and l.user_id = auth.uid()
    )
  );

create policy toon_series_locations_delete_own
  on toon_series_locations for delete
  using (
    exists (
      select 1 from toon_series s
      where s.id = toon_series_locations.series_id
        and s.user_id = auth.uid()
    )
  );

-- toon_panels의 location_id는 select/update 시 이미 존재하는
-- toon_panels RLS(002_toon_rls.sql, 부모 project 소유권 검사)로 충분히
-- 보호된다 — 새 컬럼이라고 해서 panel 자체의 RLS 정책을 바꿀 필요는
-- 없다. 다만 "내 프로젝트에 남의 location을 연결"하는 경로를 막기
-- 위해, panel INSERT/UPDATE 시 location_id 소유권 검사를 애플리케이션
-- 레벨(서버 액션)에서 수행한다(성능/단순성을 위해 series_id처럼 DB
-- 정책에서 검사하는 대신, getLocation()이 RLS로 스코프되어 남의
-- location_id를 조회하면 null이 되는 방식을 재사용할 계획 — RLS
-- 정책 추가 변경은 이번 migration에 포함하지 않는다).
