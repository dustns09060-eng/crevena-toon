-- ============================================================
-- 016_toon_panel_images_rls.sql
-- STEP 6 — toon_panel_images RLS.
--
-- 015 실행 이후에만 적용 가능. 사용자 승인 전까지 Production에
-- 실행하지 않는다.
--
-- toon_panel_images -> toon_panels -> toon_projects 순서로 소유권을
-- 확인한다(2단계 join — toon_panels 자체에는 user_id가 없다).
-- ============================================================

alter table toon_panel_images enable row level security;

create policy toon_panel_images_select_own
  on toon_panel_images for select
  using (
    exists (
      select 1 from toon_panels p
      join toon_projects proj on proj.id = p.project_id
      where p.id = toon_panel_images.panel_id
        and proj.user_id = auth.uid()
    )
  );

create policy toon_panel_images_insert_own
  on toon_panel_images for insert
  with check (
    exists (
      select 1 from toon_panels p
      join toon_projects proj on proj.id = p.project_id
      where p.id = toon_panel_images.panel_id
        and proj.user_id = auth.uid()
    )
  );

create policy toon_panel_images_update_own
  on toon_panel_images for update
  using (
    exists (
      select 1 from toon_panels p
      join toon_projects proj on proj.id = p.project_id
      where p.id = toon_panel_images.panel_id
        and proj.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from toon_panels p
      join toon_projects proj on proj.id = p.project_id
      where p.id = toon_panel_images.panel_id
        and proj.user_id = auth.uid()
    )
  );

create policy toon_panel_images_delete_own
  on toon_panel_images for delete
  using (
    exists (
      select 1 from toon_panels p
      join toon_projects proj on proj.id = p.project_id
      where p.id = toon_panel_images.panel_id
        and proj.user_id = auth.uid()
    )
  );
