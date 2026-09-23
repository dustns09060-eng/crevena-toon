-- ============================================================
-- 022_toon_project_locations.sql
-- Temporary/Story Location 도입 — Saved Location(021, toon_locations)과
-- 별개로, 이 프로젝트(에피소드) 안에서만 유효한 일회성 장소를 저장한다.
--
-- 001~021 실행 이후에만 적용 가능. 001~021은 이 파일에서 수정하지 않는다.
--
-- 설계 원칙(사용자 확정):
-- - Temporary Location 정의는 panel마다 중복 저장하지 않고, project당
--   1행으로 정의해 여러 panel이 FK로 공유 참조한다.
-- - project 삭제 시 함께 삭제되어도 되는 데이터라 on delete cascade.
-- - toon_panels.project_location_id -> toon_project_locations는
--   021의 location_id -> toon_locations와 동일하게 on delete set null
--   (실제로는 project 삭제 시 toon_panels 자체도 cascade되므로 이
--   분기가 실행될 일은 거의 없지만, 대칭성을 위해 맞춘다).
-- - 한 panel은 Saved(location_id) 또는 Temporary(project_location_id)
--   중 하나만 가질 수 있다(상호배타 CHECK) — 021의 location_id/
--   time_of_day는 이 마이그레이션에서 전혀 건드리지 않는다.
-- ============================================================

create table if not exists toon_project_locations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references toon_projects(id) on delete cascade,
  location_key text not null,
  display_name text not null,
  visual_prompt text not null,
  wall_and_floor text,
  fixed_furniture text,
  window_style text,
  recurring_props text,
  distinctive_features text,
  created_at timestamptz not null default now(),
  unique (project_id, location_key)
);

create index if not exists ix_toon_project_locations_project on toon_project_locations (project_id);

alter table toon_panels add column if not exists project_location_id uuid
  references toon_project_locations(id) on delete set null;

alter table toon_panels drop constraint if exists toon_panels_location_exclusive;
alter table toon_panels add constraint toon_panels_location_exclusive
  check (location_id is null or project_location_id is null);

create index if not exists ix_toon_panels_project_location
  on toon_panels (project_location_id) where project_location_id is not null;

-- ------------------------------------------------------------
-- RLS — toon_panels(002)와 동일한 "부모(toon_projects) 소유권
-- EXISTS 서브쿼리" 패턴. 두 번째 부모가 없으므로 toon_series_locations
-- 같은 이중 소유권 체크는 필요 없다.
-- ------------------------------------------------------------
alter table toon_project_locations enable row level security;

create policy toon_project_locations_select_own
  on toon_project_locations for select
  using (exists (select 1 from toon_projects p where p.id = toon_project_locations.project_id and p.user_id = auth.uid()));

create policy toon_project_locations_insert_own
  on toon_project_locations for insert
  with check (exists (select 1 from toon_projects p where p.id = toon_project_locations.project_id and p.user_id = auth.uid()));

create policy toon_project_locations_update_own
  on toon_project_locations for update
  using (exists (select 1 from toon_projects p where p.id = toon_project_locations.project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from toon_projects p where p.id = toon_project_locations.project_id and p.user_id = auth.uid()));

create policy toon_project_locations_delete_own
  on toon_project_locations for delete
  using (exists (select 1 from toon_projects p where p.id = toon_project_locations.project_id and p.user_id = auth.uid()));

-- ------------------------------------------------------------
-- RPC — Storyboard 저장의 DB mutation(temp location upsert + panel
-- upsert + obsolete temp location cleanup)을 하나의 Postgres
-- transaction으로 묶는다. Supabase JS의 여러 개별 호출은 자동으로
-- 하나의 트랜잭션이 되지 않으므로, 이 세 단계 중 하나라도 실패하면
-- 전체가 롤백되도록 단일 함수 안에서 처리한다.
--
-- 반드시 지킬 순서(사용자 지적 반영): 기존 temp location을 먼저
-- 지우면 안 된다 — panel이 아직 그 행을 참조하는 상태에서 지우면
-- ON DELETE SET NULL이 실행되고, 중간에 오류가 나면 panel의 참조가
-- 끊긴 채로 남을 위험이 있다. 그래서 순서를 (1) 새 temp location
-- upsert (2) panel을 새 temp location으로 다시 연결 (3) 이제 아무
-- panel도 참조하지 않는 옛 temp location 삭제 로 고정한다 — 전부
-- 같은 트랜잭션 안이므로 3번이 실패해도 1~2번까지 롤백된다.
--
-- AI 생성/검증(느린 외부 API 호출)은 이 함수 밖(TypeScript)에서 전부
-- 끝낸 뒤, 이미 확정된 결과만 이 함수에 전달한다 — 장시간 AI 호출을
-- DB transaction 안에 넣지 않는다.
--
-- p_panel_rows의 각 원소는 toon_panels 컬럼과 1:1 대응하는 JSON
-- object다. location_id가 있으면 Saved Location(021, 서버가 이미
-- LOCATION_A -> 실제 UUID로 변환 완료), temp_location_key가 있으면
-- Temporary Location(이 함수가 p_temp_locations에서 upsert한 뒤 그
-- key -> UUID로 이 함수 안에서 직접 변환한다) — AI가 반환한 원본
-- identifier 문자열 자체는 어디에도 저장하지 않는다.
-- ------------------------------------------------------------
create or replace function toon_save_storyboard_panels(
  p_project_id uuid,
  p_temp_locations jsonb,
  p_panel_rows jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_key_to_id jsonb;
begin
  if not exists (
    select 1 from toon_projects where id = p_project_id and user_id = auth.uid()
  ) then
    raise exception 'toon_save_storyboard_panels: not authorized for project %', p_project_id;
  end if;

  -- (1) 이번 draft가 정의한 Temporary Location을 upsert하고 key -> id map을 만든다.
  with upserted as (
    insert into toon_project_locations (
      project_id, location_key, display_name, visual_prompt,
      wall_and_floor, fixed_furniture, window_style, recurring_props, distinctive_features
    )
    select
      p_project_id,
      elem->>'location_key',
      elem->>'display_name',
      elem->>'visual_prompt',
      elem->>'wall_and_floor',
      elem->>'fixed_furniture',
      elem->>'window_style',
      elem->>'recurring_props',
      elem->>'distinctive_features'
    from jsonb_array_elements(coalesce(p_temp_locations, '[]'::jsonb)) as elem
    where elem->>'location_key' is not null
    on conflict (project_id, location_key) do update set
      display_name = excluded.display_name,
      visual_prompt = excluded.visual_prompt,
      wall_and_floor = excluded.wall_and_floor,
      fixed_furniture = excluded.fixed_furniture,
      window_style = excluded.window_style,
      recurring_props = excluded.recurring_props,
      distinctive_features = excluded.distinctive_features
    returning id, location_key
  )
  select coalesce(jsonb_object_agg(location_key, id::text), '{}'::jsonb) into v_key_to_id from upserted;

  -- (2) panel을 upsert한다 — temp_location_key가 있으면 위에서 만든
  --     map으로 실제 project_location_id(uuid)를 채운다.
  insert into toon_panels (
    project_id, panel_number, panel_type, scene, narration, dialogue, character_ids,
    expression, image_prompt, cover_title, cover_subtitle, location_id, time_of_day, project_location_id
  )
  select
    p_project_id,
    (elem->>'panel_number')::int,
    elem->>'panel_type',
    elem->>'scene',
    elem->>'narration',
    coalesce(elem->'dialogue', '[]'::jsonb),
    coalesce(
      (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(elem->'character_ids', '[]'::jsonb)) x),
      '{}'::uuid[]
    ),
    elem->>'expression',
    elem->>'image_prompt',
    elem->>'cover_title',
    elem->>'cover_subtitle',
    nullif(elem->>'location_id', '')::uuid,
    nullif(elem->>'time_of_day', ''),
    case
      when elem->>'temp_location_key' is not null
      then (v_key_to_id->>(elem->>'temp_location_key'))::uuid
      else null
    end
  from jsonb_array_elements(p_panel_rows) as elem
  on conflict (project_id, panel_number) do update set
    panel_type = excluded.panel_type,
    scene = excluded.scene,
    narration = excluded.narration,
    dialogue = excluded.dialogue,
    character_ids = excluded.character_ids,
    expression = excluded.expression,
    image_prompt = excluded.image_prompt,
    cover_title = excluded.cover_title,
    cover_subtitle = excluded.cover_subtitle,
    location_id = excluded.location_id,
    time_of_day = excluded.time_of_day,
    project_location_id = excluded.project_location_id;

  -- (3) 이제 어떤 panel도 참조하지 않는(이번 draft에 없는) 옛 Temporary
  --     Location만 정리한다 — panel이 먼저 새 행으로 다시 연결된
  --     뒤이므로 안전하다.
  delete from toon_project_locations
  where project_id = p_project_id
    and location_key not in (
      select elem->>'location_key'
      from jsonb_array_elements(coalesce(p_temp_locations, '[]'::jsonb)) as elem
      where elem->>'location_key' is not null
    );
end;
$$;

revoke all on function toon_save_storyboard_panels(uuid, jsonb, jsonb) from public;
grant execute on function toon_save_storyboard_panels(uuid, jsonb, jsonb) to authenticated;
