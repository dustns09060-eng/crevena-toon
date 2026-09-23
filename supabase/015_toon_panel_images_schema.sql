-- ============================================================
-- 015_toon_panel_images_schema.sql
-- STEP 6 — 컷(panel) 이미지 생성 이력을 추적하는 테이블.
--
-- 001~014 실행 이후에만 적용 가능. 사용자 승인 전까지 Production에
-- 실행하지 않는다. 기존 마이그레이션 파일(001~014)은 수정하지 않는다.
--
-- toon_character_sheets(STEP 4)와 동일한 candidate/approved 워크플로우를
-- panel 이미지에도 적용한다. 생성마다 새 row가 'candidate'로 추가되고,
-- 사용자가 승인하면 그 row만 'approved'로 바뀌며 기존 approved는
-- 'rejected'로 내려간다. toon_panels.raw_image_url이 "현재 approved
-- 이미지"를 가리키는 포인터 역할을 한다(001에 이미 존재하는 컬럼).
--
-- prompt_snapshot: 생성 당시 실제로 모델에 보낸 최종 prompt 전체를
-- 보존해, 나중에 왜 특정 이미지가 나왔는지 재현할 수 있게 한다.
-- ============================================================

create table if not exists toon_panel_images (
  id uuid primary key default gen_random_uuid(),
  panel_id uuid not null references toon_panels(id) on delete cascade,
  generation_id uuid references toon_generations(id) on delete set null,

  provider text not null,
  model text not null,
  status text not null default 'candidate'
    check (status in ('candidate', 'approved', 'rejected')),

  storage_path text not null,
  generation_version int not null check (generation_version > 0),
  prompt_snapshot text not null,

  created_at timestamptz not null default now()
);

-- panel당 approved 이미지는 최대 1개만 허용
create unique index if not exists ux_toon_panel_images_approved
  on toon_panel_images (panel_id)
  where status = 'approved';

create index if not exists ix_toon_panel_images_panel_created
  on toon_panel_images (panel_id, created_at desc);
