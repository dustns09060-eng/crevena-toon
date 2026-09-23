import { describe, expect, test } from "vitest";
import { checkCompletionReadiness, getProjectStatusLabel } from "../../lib/projects/finalUtils";
import type { ToonPanel, ToonProject } from "../../src/db/types";

const PROJECT: ToonProject = {
  id: "proj-1",
  user_id: "user-a",
  title: "제목",
  topic: null,
  category: null,
  tone: null,
  panel_count: 6,
  status: "confirmed",
  story_summary: "요약",
  series_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function makePanel(overrides: Partial<ToonPanel>): ToonPanel {
  return {
    id: "panel-1",
    project_id: "proj-1",
    panel_number: 1,
    panel_type: "scene",
    scene: null,
    narration: null,
    narration_bubble: null,
    cover_title: null,
    cover_subtitle: null,
    cover_title_bubble: null,
    dialogue: [],
    character_ids: [],
    expression: null,
    image_prompt: null,
    image_url: null,
    raw_image_url: null,
    generation_version: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("checkCompletionReadiness", () => {
  test("모든 컷에 raw+final이 있으면 ready=true", () => {
    const panels = [
      makePanel({ id: "p1", panel_number: 1, raw_image_url: "raw1", image_url: "final1" }),
      makePanel({ id: "p2", panel_number: 2, raw_image_url: "raw2", image_url: "final2" }),
    ];
    const result = checkCompletionReadiness(PROJECT, panels);
    expect(result.ready).toBe(true);
  });

  test("final image가 없는 컷이 하나라도 있으면 차단되고 안내 문구를 포함한다", () => {
    const panels = [
      makePanel({ id: "p1", panel_number: 1, raw_image_url: "raw1", image_url: "final1" }),
      makePanel({ id: "p2", panel_number: 2, raw_image_url: "raw2", image_url: null }),
    ];
    const result = checkCompletionReadiness(PROJECT, panels);
    expect(result.ready).toBe(false);
    expect(result.errors.join()).toMatch(/아직 최종 이미지가 만들어지지 않은 컷이 있어요/);
  });

  test("raw 이미지가 없는 컷이 있으면 차단된다", () => {
    const panels = [makePanel({ id: "p1", panel_number: 1, raw_image_url: null, image_url: null })];
    const result = checkCompletionReadiness(PROJECT, panels);
    expect(result.ready).toBe(false);
  });

  test("storyboard가 confirmed/completed가 아니면 차단된다", () => {
    const draftProject = { ...PROJECT, status: "storyboard" as const };
    const panels = [makePanel({ id: "p1", panel_number: 1, raw_image_url: "r", image_url: "f" })];
    const result = checkCompletionReadiness(draftProject, panels);
    expect(result.ready).toBe(false);
  });

  test("프로젝트가 없으면 ready=false", () => {
    const result = checkCompletionReadiness(null, []);
    expect(result.ready).toBe(false);
  });

  test("컷이 하나도 없으면 ready=false", () => {
    const result = checkCompletionReadiness(PROJECT, []);
    expect(result.ready).toBe(false);
  });

  test("이미 completed 상태에서도 조건을 만족하면 ready=true (재확인 가능)", () => {
    const completedProject = { ...PROJECT, status: "completed" as const };
    const panels = [makePanel({ id: "p1", panel_number: 1, raw_image_url: "r", image_url: "f" })];
    const result = checkCompletionReadiness(completedProject, panels);
    expect(result.ready).toBe(true);
  });
});

describe("getProjectStatusLabel", () => {
  test("draft -> 작성 중", () => {
    expect(getProjectStatusLabel({ ...PROJECT, status: "draft" }, [])).toBe("작성 중");
  });

  test("storyboard -> 스토리보드 작성 중", () => {
    expect(getProjectStatusLabel({ ...PROJECT, status: "storyboard" }, [])).toBe("스토리보드 작성 중");
  });

  test("completed -> 완성", () => {
    expect(getProjectStatusLabel({ ...PROJECT, status: "completed" }, [])).toBe("완성");
  });

  test("confirmed + raw/final 없음 -> 이미지 제작 중", () => {
    const panels = [makePanel({ id: "p1", panel_number: 1 })];
    expect(getProjectStatusLabel(PROJECT, panels)).toBe("이미지 제작 중");
  });

  test("confirmed + 모든 raw 있음, final 없음 -> 최종 편집 중", () => {
    const panels = [makePanel({ id: "p1", panel_number: 1, raw_image_url: "r" })];
    expect(getProjectStatusLabel(PROJECT, panels)).toBe("최종 편집 중");
  });

  test("confirmed + 모든 final 있음 -> 최종 확인 중", () => {
    const panels = [makePanel({ id: "p1", panel_number: 1, raw_image_url: "r", image_url: "f" })];
    expect(getProjectStatusLabel(PROJECT, panels)).toBe("최종 확인 중");
  });
});
