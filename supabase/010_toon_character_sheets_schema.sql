-- ============================================================
-- 010_toon_character_sheets_schema.sql
-- STEP 4 — Character Sheet 생성 이력을 추적하는 테이블.
--
-- 001~009 실행 이후에만 적용 가능. 사용자 승인 전까지 Production에
-- 실행하지 않는다. 기존 마이그레이션 파일(001~009)은 수정하지 않는다.
--
-- candidate/approved 워크플로우: 생성될 때마다 새 row가 status='candidate'로
-- 추가된다. 사용자가 승인하면 그 row만 'approved'로 바뀌고, 같은 캐릭터의
-- 기존 approved row는 'rejected'로 내려간다 (원본 이미지/기록은 삭제하지
-- 않고 보존 — 재생성 시 새 generation/version으로만 쌓인다).
--
-- character_bible_snapshot: 생성 당시 사용한 Character Bible 값을 그대로
-- JSONB로 보존한다. 이후 Character Bible이 바뀌어도 "이 Character Sheet가
-- 어떤 설정으로 만들어졌는지" 재현할 수 있게 하기 위함이다.
-- ============================================================

create table if not exists toon_character_sheets (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references toon_characters(id) on delete cascade,
  generation_id uuid references toon_generations(id) on delete set null,

  provider text not null,
  model text not null,
  status text not null default 'candidate'
    check (status in ('candidate', 'approved', 'rejected')),

  storage_path text not null,
  generation_version int not null check (generation_version > 0),
  character_bible_snapshot jsonb not null,

  created_at timestamptz not null default now()
);

-- 캐릭터당 approved는 최대 1개만 허용
create unique index if not exists ux_toon_character_sheets_approved
  on toon_character_sheets (character_id)
  where status = 'approved';

create index if not exists ix_toon_character_sheets_character_created
  on toon_character_sheets (character_id, created_at desc);
