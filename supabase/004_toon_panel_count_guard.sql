-- ============================================================
-- 004_toon_panel_count_guard.sql
-- STEP 1.5 — panel_number가 project.panel_count를 벗어나지 않도록
-- DB 레벨 defense-in-depth 추가.
--
-- 001/002/003 실행 이후에만 적용 가능. 사용자 승인 전까지 실행하지 않는다.
--
-- CHECK 제약만으로는 다른 테이블(toon_projects)의 값을 참조할 수 없어서
-- (Postgres CHECK는 같은 row 내부 값만 볼 수 있음) 트리거로 구현한다.
-- 두 가지 경로를 모두 막는다:
--   1) toon_panels INSERT/UPDATE 시 panel_number가 부모 project의
--      panel_count를 넘지 않는지 확인
--   2) toon_projects.panel_count UPDATE 시, 이미 존재하는 panel 중
--      새 panel_count를 넘는 panel_number가 있으면 거부
-- ============================================================

create or replace function toon_check_panel_number()
returns trigger
language plpgsql
as $$
declare
  v_panel_count int;
begin
  select panel_count into v_panel_count
  from toon_projects
  where id = new.project_id;

  if v_panel_count is null then
    raise exception 'toon_panels.project_id(%)가 존재하지 않는 프로젝트를 참조합니다', new.project_id
      using errcode = '23503'; -- foreign_key_violation
  end if;

  if new.panel_number < 1 or new.panel_number > v_panel_count then
    raise exception 'panel_number %은(는) 프로젝트의 panel_count %을(를) 벗어납니다', new.panel_number, v_panel_count
      using errcode = '23514'; -- check_violation
  end if;

  return new;
end;
$$;

drop trigger if exists trg_toon_panels_check_panel_number on toon_panels;
create trigger trg_toon_panels_check_panel_number
  before insert or update of panel_number, project_id on toon_panels
  for each row execute function toon_check_panel_number();

create or replace function toon_check_panel_count_shrink()
returns trigger
language plpgsql
as $$
declare
  v_max_panel int;
begin
  if new.panel_count < old.panel_count then
    select max(panel_number) into v_max_panel
    from toon_panels
    where project_id = new.id;

    if v_max_panel is not null and v_max_panel > new.panel_count then
      raise exception 'panel_count를 %(으)로 줄일 수 없습니다 — 이미 panel_number %이(가) 존재합니다', new.panel_count, v_max_panel
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_toon_projects_check_panel_count_shrink on toon_projects;
create trigger trg_toon_projects_check_panel_count_shrink
  before update of panel_count on toon_projects
  for each row execute function toon_check_panel_count_shrink();
