-- ============================================================
-- 011_toon_character_sheets_rls.sql
-- STEP 4 — toon_character_sheets RLS.
--
-- 010 실행 이후에만 적용 가능. 사용자 승인 전까지 Production에
-- 실행하지 않는다.
--
-- toon_character_references와 동일한 패턴: user_id 컬럼이 없으므로
-- 부모 toon_characters의 소유권(auth.uid() = user_id)을 확인한다.
-- ============================================================

alter table toon_character_sheets enable row level security;

create policy toon_character_sheets_select_own
  on toon_character_sheets for select
  using (
    exists (
      select 1 from toon_characters c
      where c.id = toon_character_sheets.character_id
        and c.user_id = auth.uid()
    )
  );

create policy toon_character_sheets_insert_own
  on toon_character_sheets for insert
  with check (
    exists (
      select 1 from toon_characters c
      where c.id = toon_character_sheets.character_id
        and c.user_id = auth.uid()
    )
  );

create policy toon_character_sheets_update_own
  on toon_character_sheets for update
  using (
    exists (
      select 1 from toon_characters c
      where c.id = toon_character_sheets.character_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from toon_characters c
      where c.id = toon_character_sheets.character_id
        and c.user_id = auth.uid()
    )
  );

create policy toon_character_sheets_delete_own
  on toon_character_sheets for delete
  using (
    exists (
      select 1 from toon_characters c
      where c.id = toon_character_sheets.character_id
        and c.user_id = auth.uid()
    )
  );
