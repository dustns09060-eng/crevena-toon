-- ============================================================
-- 001_toon_schema.sql
-- AI 인스타툰 메이커 — 테이블 정의
--
-- 주의: 이 파일은 STEP 1 설계 산출물이며, 사용자 승인 전까지
-- 어떤 Supabase 프로젝트(특히 Crevena Production)에도 실행하지 않는다.
-- 기존 Crevena 테이블/스키마와 이름이 겹치지 않도록 모든 테이블에
-- toon_ 접두사를 사용했다.
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- updated_at 자동 갱신 트리거 함수 (이 스키마 전용)
-- ------------------------------------------------------------
create or replace function toon_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 1) toon_characters — Character Bible
-- ------------------------------------------------------------
create table if not exists toon_characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  display_name text not null,
  role text,
  age_group text,
  hairstyle text,
  hair_color text,
  face_features text,
  body_type text,
  representative_outfit text,
  personality text,
  speaking_style text,
  visual_prompt text not null,
  negative_constraints text,

  -- 캐릭터 기준 시트(정면/3-4방향/전신/표정 등을 모은 대표 이미지) 1장.
  -- 개별 참조/변형 이미지는 toon_character_references에서 관리한다 (아래 2번 설계 참조).
  character_sheet_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_toon_characters_updated_at on toon_characters;
create trigger trg_toon_characters_updated_at
  before update on toon_characters
  for each row execute function toon_set_updated_at();

-- ------------------------------------------------------------
-- 1-1) toon_character_references — 캐릭터별 참조 이미지 (정규화 테이블)
-- STEP 1 설계 보고서 4번 항목 참조: 단순 URL 배열이 아니라 별도 테이블로 분리.
-- ------------------------------------------------------------
create table if not exists toon_character_references (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references toon_characters(id) on delete cascade,

  variant text not null check (variant in ('original', 'crop', 'background_removed')),
  storage_path text not null,
  is_primary boolean not null default false,
  sort_order int not null default 0,

  created_at timestamptz not null default now()
);

-- 캐릭터당 primary 참조 이미지는 최대 1장만 허용
create unique index if not exists ux_toon_character_references_primary
  on toon_character_references (character_id)
  where is_primary;

-- ------------------------------------------------------------
-- 2) toon_projects
-- ------------------------------------------------------------
create table if not exists toon_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  title text not null,
  topic text,
  category text,
  tone text,
  panel_count int not null check (panel_count in (6, 8, 10)),

  status text not null default 'draft'
    check (status in ('draft', 'storyboard', 'generating', 'completed', 'failed')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_toon_projects_updated_at on toon_projects;
create trigger trg_toon_projects_updated_at
  before update on toon_projects
  for each row execute function toon_set_updated_at();

-- ------------------------------------------------------------
-- 3) toon_project_characters — 프로젝트 <-> 캐릭터 N:M
-- ------------------------------------------------------------
create table if not exists toon_project_characters (
  project_id uuid not null references toon_projects(id) on delete cascade,
  character_id uuid not null references toon_characters(id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (project_id, character_id)
);

-- ------------------------------------------------------------
-- 4) toon_panels
--
-- dialogue: 컷에 등장하는 대사 목록. 각 항목에 말풍선 위치 정보(bubble)를
-- 함께 내장한다 — 별도 top-level bubbles 배열로 분리하면 인덱스 기반으로
-- dialogue와 매칭을 유지해야 해서 동기화 버그가 생기기 쉽다. 대사 1줄 =
-- 말풍선 1개이므로 같은 JSONB 원소 안에 두는 것이 더 안전하다.
-- (STEP 1 설계 보고서 5번 항목 참조)
--
-- [
--   {
--     "id": "uuid",
--     "character_id": "uuid",
--     "text": "드디어 잤다!",
--     "bubble_type": "speech",
--     "bubble": {
--       "x": 0.15, "y": 0.10, "width": 0.40, "height": 0.20,
--       "tail_direction": "bottom-left"
--     }
--   }
-- ]
--
-- 좌표는 0~1 normalized 값(이미지 픽셀 아님) — 해상도가 달라져도
-- 동일한 상대 위치를 유지하기 위함.
-- ------------------------------------------------------------
create table if not exists toon_panels (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references toon_projects(id) on delete cascade,

  panel_number int not null check (panel_number > 0),
  scene text,
  narration text,
  dialogue jsonb not null default '[]'::jsonb,
  expression text,

  image_prompt text,
  image_url text,
  raw_image_url text,
  generation_version int not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, panel_number)
);

drop trigger if exists trg_toon_panels_updated_at on toon_panels;
create trigger trg_toon_panels_updated_at
  before update on toon_panels
  for each row execute function toon_set_updated_at();

-- ------------------------------------------------------------
-- 5) toon_captions
-- ------------------------------------------------------------
create table if not exists toon_captions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references toon_projects(id) on delete cascade,

  caption text,
  hashtags text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_toon_captions_updated_at on toon_captions;
create trigger trg_toon_captions_updated_at
  before update on toon_captions
  for each row execute function toon_set_updated_at();

-- ------------------------------------------------------------
-- 6) toon_generations — 모든 AI 호출 비용/상태 추적
-- ------------------------------------------------------------
create table if not exists toon_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references toon_projects(id) on delete set null,
  panel_id uuid references toon_panels(id) on delete set null,

  generation_type text not null
    check (generation_type in (
      'topic', 'storyboard', 'character', 'character_sheet',
      'panel_image', 'caption', 'regenerate'
    )),

  provider text not null,
  model text not null,

  status text not null default 'pending'
    check (status in ('pending', 'success', 'failed', 'refunded')),

  image_count int not null default 0,
  input_tokens int,
  output_tokens int,
  estimated_cost_usd numeric(10, 4),
  credits_used int,

  error_code text,
  error_message text,

  created_at timestamptz not null default now()
);
