-- ============================================================
-- 002_toon_rls.sql
-- AI 인스타툰 메이커 — Row Level Security
--
-- 주의: 001_toon_schema.sql 실행 이후에만 적용 가능. 사용자 승인
-- 전까지 어떤 Supabase 프로젝트에도 실행하지 않는다.
--
-- 원칙: 모든 사용자 데이터는 auth.uid() = user_id 기반으로 격리된다.
-- user_id 컬럼이 없는 child table(toon_project_characters,
-- toon_character_references, toon_panels, toon_captions)은
-- 부모 테이블(toon_projects 또는 toon_characters)의 소유권을
-- EXISTS 서브쿼리로 확인한다.
-- ============================================================

-- ------------------------------------------------------------
-- toon_characters
-- ------------------------------------------------------------
alter table toon_characters enable row level security;

create policy toon_characters_select_own
  on toon_characters for select
  using (auth.uid() = user_id);

create policy toon_characters_insert_own
  on toon_characters for insert
  with check (auth.uid() = user_id);

create policy toon_characters_update_own
  on toon_characters for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy toon_characters_delete_own
  on toon_characters for delete
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- toon_character_references (부모: toon_characters)
-- ------------------------------------------------------------
alter table toon_character_references enable row level security;

create policy toon_character_references_select_own
  on toon_character_references for select
  using (
    exists (
      select 1 from toon_characters c
      where c.id = toon_character_references.character_id
        and c.user_id = auth.uid()
    )
  );

create policy toon_character_references_insert_own
  on toon_character_references for insert
  with check (
    exists (
      select 1 from toon_characters c
      where c.id = toon_character_references.character_id
        and c.user_id = auth.uid()
    )
  );

create policy toon_character_references_update_own
  on toon_character_references for update
  using (
    exists (
      select 1 from toon_characters c
      where c.id = toon_character_references.character_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from toon_characters c
      where c.id = toon_character_references.character_id
        and c.user_id = auth.uid()
    )
  );

create policy toon_character_references_delete_own
  on toon_character_references for delete
  using (
    exists (
      select 1 from toon_characters c
      where c.id = toon_character_references.character_id
        and c.user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- toon_projects
-- ------------------------------------------------------------
alter table toon_projects enable row level security;

create policy toon_projects_select_own
  on toon_projects for select
  using (auth.uid() = user_id);

create policy toon_projects_insert_own
  on toon_projects for insert
  with check (auth.uid() = user_id);

create policy toon_projects_update_own
  on toon_projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy toon_projects_delete_own
  on toon_projects for delete
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- toon_project_characters (부모: toon_projects + toon_characters 둘 다 확인)
-- 두 부모를 모두 검사하는 이유: 프로젝트는 내 것이지만 캐릭터는
-- 남의 것을 연결하려는 시도를 막기 위함.
-- ------------------------------------------------------------
alter table toon_project_characters enable row level security;

create policy toon_project_characters_select_own
  on toon_project_characters for select
  using (
    exists (
      select 1 from toon_projects p
      where p.id = toon_project_characters.project_id
        and p.user_id = auth.uid()
    )
  );

create policy toon_project_characters_insert_own
  on toon_project_characters for insert
  with check (
    exists (
      select 1 from toon_projects p
      where p.id = toon_project_characters.project_id
        and p.user_id = auth.uid()
    )
    and exists (
      select 1 from toon_characters c
      where c.id = toon_project_characters.character_id
        and c.user_id = auth.uid()
    )
  );

create policy toon_project_characters_delete_own
  on toon_project_characters for delete
  using (
    exists (
      select 1 from toon_projects p
      where p.id = toon_project_characters.project_id
        and p.user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- toon_panels (부모: toon_projects)
-- ------------------------------------------------------------
alter table toon_panels enable row level security;

create policy toon_panels_select_own
  on toon_panels for select
  using (
    exists (
      select 1 from toon_projects p
      where p.id = toon_panels.project_id
        and p.user_id = auth.uid()
    )
  );

create policy toon_panels_insert_own
  on toon_panels for insert
  with check (
    exists (
      select 1 from toon_projects p
      where p.id = toon_panels.project_id
        and p.user_id = auth.uid()
    )
  );

create policy toon_panels_update_own
  on toon_panels for update
  using (
    exists (
      select 1 from toon_projects p
      where p.id = toon_panels.project_id
        and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from toon_projects p
      where p.id = toon_panels.project_id
        and p.user_id = auth.uid()
    )
  );

create policy toon_panels_delete_own
  on toon_panels for delete
  using (
    exists (
      select 1 from toon_projects p
      where p.id = toon_panels.project_id
        and p.user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- toon_captions (부모: toon_projects)
-- ------------------------------------------------------------
alter table toon_captions enable row level security;

create policy toon_captions_select_own
  on toon_captions for select
  using (
    exists (
      select 1 from toon_projects p
      where p.id = toon_captions.project_id
        and p.user_id = auth.uid()
    )
  );

create policy toon_captions_insert_own
  on toon_captions for insert
  with check (
    exists (
      select 1 from toon_projects p
      where p.id = toon_captions.project_id
        and p.user_id = auth.uid()
    )
  );

create policy toon_captions_update_own
  on toon_captions for update
  using (
    exists (
      select 1 from toon_projects p
      where p.id = toon_captions.project_id
        and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from toon_projects p
      where p.id = toon_captions.project_id
        and p.user_id = auth.uid()
    )
  );

create policy toon_captions_delete_own
  on toon_captions for delete
  using (
    exists (
      select 1 from toon_projects p
      where p.id = toon_captions.project_id
        and p.user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- toon_generations
-- user_id를 직접 갖고 있지만, project_id/panel_id로 다른 사람의
-- 프로젝트에 로그를 꽂아 넣지 못하도록 insert 시 추가 검증한다.
-- 이 테이블은 비용/사용량 로그이므로 update는 애플리케이션(서버)
-- 레벨에서만 상태 전이(pending -> success/failed/refunded)를
-- 수행한다고 가정하고, 클라이언트에는 update 정책을 열어주지 않는다.
-- ------------------------------------------------------------
alter table toon_generations enable row level security;

create policy toon_generations_select_own
  on toon_generations for select
  using (auth.uid() = user_id);

create policy toon_generations_insert_own
  on toon_generations for insert
  with check (
    auth.uid() = user_id
    and (
      project_id is null
      or exists (
        select 1 from toon_projects p
        where p.id = toon_generations.project_id
          and p.user_id = auth.uid()
      )
    )
    and (
      panel_id is null
      or exists (
        select 1 from toon_panels pn
        join toon_projects p on p.id = pn.project_id
        where pn.id = toon_generations.panel_id
          and p.user_id = auth.uid()
      )
    )
  );

-- delete/update 정책은 의도적으로 만들지 않는다 (비용 로그는
-- 클라이언트가 수정/삭제할 수 없어야 하며, 상태 갱신은 service_role로만 수행).
