import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const getProjectMock = vi.fn();
const getProjectCharactersMock = vi.fn();
const getProjectPanelsMock = vi.fn();
vi.mock("../../lib/projects/service", () => ({
  getProject: (...args: unknown[]) => getProjectMock(...args),
  getProjectCharacters: (...args: unknown[]) => getProjectCharactersMock(...args),
  getProjectPanels: (...args: unknown[]) => getProjectPanelsMock(...args),
}));

const generateStoryboardMock = vi.fn();
vi.mock("../../src/providers/storyboardProviderRegistry", () => ({
  getStoryboardProvider: () => ({ id: "gemini", generateStoryboard: generateStoryboardMock, generateIdeas: vi.fn() }),
}));

function createSupabaseMock() {
  const calls: Record<string, unknown[]> = {};
  function record(key: string, arg?: unknown) {
    (calls[key] ??= []).push(arg);
  }
  function makeBuilder(table: string) {
    const builder: Record<string, unknown> = {
      upsert(rows: unknown, opts: unknown) {
        record(`${table}.upsert`, { rows, opts });
        return Promise.resolve({ error: null });
      },
      update(payload: unknown) {
        record(`${table}.update`, payload);
        return {
          eq(col: string, val: unknown) {
            record(`${table}.update.eq`, { col, val });
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    return builder;
  }
  return {
    _calls: calls,
    auth: { getUser: async () => ({ data: { user: OWNED_USER } }) },
    from: (t: string) => makeBuilder(t),
  };
}

const OWNED_USER = { id: "user-a" };
const OWNED_PROJECT = {
  id: "proj-1",
  user_id: "user-a",
  title: "제목",
  topic: "소재 텍스트",
  panel_count: 6,
  status: "draft",
  story_summary: null,
};
const PROJECT_CHARACTERS = [
  { id: "33333333-3333-4333-8333-333333333333", display_name: "엄마", role: "주인공", personality: null, speaking_style: null },
];

let currentSupabase: ReturnType<typeof createSupabaseMock>;
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => currentSupabase,
}));

beforeEach(() => {
  vi.clearAllMocks();
  currentSupabase = createSupabaseMock();
  getProjectMock.mockResolvedValue(OWNED_PROJECT);
  getProjectCharactersMock.mockResolvedValue(PROJECT_CHARACTERS);
});

function makeRawStoryboard(panelCount: number) {
  return {
    title: "제목",
    summary: "요약",
    panels: Array.from({ length: panelCount }, (_, i) => ({
      panel_number: i + 1,
      scene_description: `장면 ${i + 1}`,
      characters: ["엄마"],
      expressions: ["웃음"],
      actions: [],
      dialogue: [{ character: "엄마", text: "대사" }],
      narration: null,
      image_prompt: `image prompt ${i + 1}`,
    })),
  };
}

describe("generateStoryboardAction", () => {
  test("타인 프로젝트는 거부된다", async () => {
    getProjectMock.mockResolvedValue(null);
    const { generateStoryboardAction } = await import("../../lib/projects/storyboard");

    const result = await generateStoryboardAction("someone-elses-project");
    expect(result.ok).toBe(false);
    expect(generateStoryboardMock).not.toHaveBeenCalled();
  });

  test.each([6, 8, 10] as const)("%i컷 요청 시 정확히 %i개 panel을 반환한다", async (count) => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: count });
    generateStoryboardMock.mockResolvedValue(makeRawStoryboard(count));
    const { generateStoryboardAction } = await import("../../lib/projects/storyboard");

    const result = await generateStoryboardAction("proj-1");
    expect(result.ok).toBe(true);
    expect(result.draft?.panels).toHaveLength(count);
  });

  test("AI가 요청한 컷 수와 다른 개수를 반환하면 거부되고 DB를 건드리지 않는다", async () => {
    generateStoryboardMock.mockResolvedValue(makeRawStoryboard(5)); // 6컷 요청인데 5개 반환
    const { generateStoryboardAction } = await import("../../lib/projects/storyboard");

    const result = await generateStoryboardAction("proj-1");
    expect(result.ok).toBe(false);
    expect(currentSupabase._calls["toon_panels.upsert"]).toBeUndefined();
    expect(currentSupabase._calls["toon_projects.update"]).toBeUndefined();
  });

  test("생성 실패 시 기존 저장된 storyboard는 건드리지 않는다 (재생성 실패 시 기존 유지)", async () => {
    generateStoryboardMock.mockRejectedValue(new Error("provider boom"));
    const { generateStoryboardAction } = await import("../../lib/projects/storyboard");

    const result = await generateStoryboardAction("proj-1");
    expect(result.ok).toBe(false);
    expect(currentSupabase._calls["toon_panels.upsert"]).toBeUndefined();
  });

  test("동시에 같은 프로젝트를 두 번 요청하면 두 번째는 즉시 거부된다 (중복 요청 방지)", async () => {
    let resolveGen: (v: ReturnType<typeof makeRawStoryboard>) => void;
    generateStoryboardMock.mockReturnValue(
      new Promise((resolve) => {
        resolveGen = resolve;
      })
    );
    const { generateStoryboardAction } = await import("../../lib/projects/storyboard");

    const first = generateStoryboardAction("proj-1");
    await new Promise((r) => setTimeout(r, 0));
    const second = await generateStoryboardAction("proj-1");

    expect(second.ok).toBe(false);
    expect(second.message).toMatch(/이미/);

    resolveGen!(makeRawStoryboard(6));
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
  });
});

describe("saveStoryboardAction", () => {
  const validDraft = {
    title: "제목",
    summary: "요약",
    panels: [
      {
        panel_number: 1,
        scene_description: "장면",
        character_ids: ["33333333-3333-4333-8333-333333333333"],
        expression: "웃음",
        dialogue: [{ id: "11111111-1111-4111-8111-111111111111", character_id: "33333333-3333-4333-8333-333333333333", text: "안녕" }],
        narration: null,
        image_prompt: "prompt",
      },
    ],
  };

  test("타인 프로젝트에는 저장할 수 없다", async () => {
    getProjectMock.mockResolvedValue(null);
    const { saveStoryboardAction } = await import("../../lib/projects/storyboard");

    const result = await saveStoryboardAction("someone-elses-project", {
      ...validDraft,
      panels: Array(6).fill(validDraft.panels[0]),
    });
    expect(result.ok).toBe(false);
  });

  test("AI 재호출 없이(직접 수정만으로) 저장된다", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 1 });
    const { saveStoryboardAction } = await import("../../lib/projects/storyboard");

    const result = await saveStoryboardAction("proj-1", validDraft);
    expect(result.ok).toBe(true);
    expect(generateStoryboardMock).not.toHaveBeenCalled();
    expect(currentSupabase._calls["toon_panels.upsert"]).toBeDefined();
  });

  test("허용되지 않은 character_id가 포함되면 거부된다", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 1 });
    const badDraft = {
      ...validDraft,
      panels: [{ ...validDraft.panels[0], character_ids: ["not-a-project-character"] }],
    };
    const { saveStoryboardAction } = await import("../../lib/projects/storyboard");

    const result = await saveStoryboardAction("proj-1", badDraft);
    expect(result.ok).toBe(false);
    expect(currentSupabase._calls["toon_panels.upsert"]).toBeUndefined();
  });

  test("대사 화자가 해당 컷 등장인물에 없으면 거부된다", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 1 });
    const badDraft = {
      ...validDraft,
      panels: [
        {
          ...validDraft.panels[0],
          character_ids: [],
          dialogue: [{ id: "11111111-1111-4111-8111-111111111111", character_id: "33333333-3333-4333-8333-333333333333", text: "안녕" }],
        },
      ],
    };
    const { saveStoryboardAction } = await import("../../lib/projects/storyboard");

    const result = await saveStoryboardAction("proj-1", badDraft);
    expect(result.ok).toBe(false);
  });

  test("panel_number가 1부터 연속되지 않으면 거부된다", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 1 });
    const badDraft = { ...validDraft, panels: [{ ...validDraft.panels[0], panel_number: 2 }] };
    const { saveStoryboardAction } = await import("../../lib/projects/storyboard");

    const result = await saveStoryboardAction("proj-1", badDraft);
    expect(result.ok).toBe(false);
  });
});

describe("confirmStoryboardAction", () => {
  test("저장된 panel 개수가 project.panel_count와 다르면 확정을 거부한다", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 6 });
    getProjectPanelsMock.mockResolvedValue([{}, {}]); // 2개뿐, 6개 필요
    const { confirmStoryboardAction } = await import("../../lib/projects/storyboard");

    const result = await confirmStoryboardAction("proj-1");
    expect(result.ok).toBe(false);
    expect(currentSupabase._calls["toon_projects.update"]).toBeUndefined();
  });

  test("panel이 모두 저장돼 있으면 확정된다", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 2 });
    getProjectPanelsMock.mockResolvedValue([{}, {}]);
    const { confirmStoryboardAction } = await import("../../lib/projects/storyboard");

    const result = await confirmStoryboardAction("proj-1");
    expect(result.ok).toBe(true);
    const updates = currentSupabase._calls["toon_projects.update"] as Record<string, unknown>[];
    expect(updates[0]).toEqual({ status: "confirmed" });
  });

  test("타인 프로젝트는 확정할 수 없다", async () => {
    getProjectMock.mockResolvedValue(null);
    const { confirmStoryboardAction } = await import("../../lib/projects/storyboard");

    const result = await confirmStoryboardAction("someone-elses-project");
    expect(result.ok).toBe(false);
  });
});
