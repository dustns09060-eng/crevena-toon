import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const getProjectMock = vi.fn();
const getProjectCharactersMock = vi.fn();
const getProjectPanelsMock = vi.fn();
const cleanupProjectStorageMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../lib/projects/service", () => ({
  getProject: (...args: unknown[]) => getProjectMock(...args),
  getProjectCharacters: (...args: unknown[]) => getProjectCharactersMock(...args),
  getProjectPanels: (...args: unknown[]) => getProjectPanelsMock(...args),
  cleanupProjectStorage: (...args: unknown[]) => cleanupProjectStorageMock(...args),
}));

const generateStoryboardMock = vi.fn();
vi.mock("../../src/providers/storyboardProviderRegistry", () => ({
  getStoryboardProvider: () => ({ id: "gemini", generateStoryboard: generateStoryboardMock, generateIdeas: vi.fn() }),
}));

const getCharacterMock = vi.fn();
vi.mock("../../lib/characters/service", () => ({
  getCharacter: (...args: unknown[]) => getCharacterMock(...args),
}));

function createSupabaseMock(config: { storageFiles?: Record<string, { name: string }[]> } = {}) {
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
        return builder;
      },
      delete() {
        record(`${table}.delete`);
        return builder;
      },
      insert(payload: unknown) {
        record(`${table}.insert`, payload);
        return Promise.resolve({ error: null });
      },
      eq(col: string, val: unknown) {
        record(`${table}.eq`, { col, val });
        return builder;
      },
      gt(col: string, val: unknown) {
        record(`${table}.gt`, { col, val });
        return Promise.resolve({ error: null });
      },
      in(col: string, val: unknown) {
        record(`${table}.in`, { col, val });
        return Promise.resolve({ error: null });
      },
      then(resolve: (v: { error: null }) => void) {
        resolve({ error: null });
      },
    };
    return builder;
  }
  return {
    _calls: calls,
    auth: { getUser: async () => ({ data: { user: OWNED_USER } }) },
    // 022 — saveStoryboardAction/regenerateStoryboardWithSettingsAction은
    // 이제 toon_panels.upsert()를 직접 부르지 않고 toon_save_storyboard_panels
    // RPC로 커밋한다. 기존 테스트들이 "toon_panels.upsert 호출 여부/내용"으로
    // 커밋 성공을 검증하므로, 이 mock도 같은 키에 기록해 기존 단언을 그대로 재사용한다.
    rpc: async (fnName: string, args: Record<string, unknown>): Promise<{ error: { message: string } | null }> => {
      record(`rpc.${fnName}`, args);
      if (fnName === "toon_save_storyboard_panels") {
        record("toon_panels.upsert", { rows: args.p_panel_rows, opts: { onConflict: "project_id,panel_number" } });
      }
      return { error: null };
    },
    storage: {
      from(bucket: string) {
        return {
          list: async (prefix: string) => {
            record(`storage.${bucket}.list`, prefix);
            return { data: config.storageFiles?.[prefix] ?? [], error: null };
          },
          remove: async (paths: string[]) => {
            record(`storage.${bucket}.remove`, paths);
            return { error: null };
          },
        };
      },
    },
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
  // 기본값: 기존에 저장된 panel이 없는(=아직 표지도 없는) 상태.
  // saveStoryboardAction의 표지 삭제 방지 검사가 기존 panel 목록을 조회하므로 필요하다.
  getProjectPanelsMock.mockResolvedValue([]);
  getCharacterMock.mockResolvedValue({ id: "char-x", display_name: "누군가" });
});

/** totalCount(표지 포함 TOTAL)에 맞춰 cover 1개 + panels(totalCount-1)개를 만든다. */
function makeRawStoryboard(totalCount: number) {
  const sceneCount = totalCount - 1;
  return {
    title: "제목",
    summary: "요약",
    cover: {
      cover_title: "표지 제목",
      cover_subtitle: null,
      scene_description: "표지 장면",
      characters: ["CHARACTER_A"],
      image_prompt: "cover image prompt",
    },
    panels: Array.from({ length: sceneCount }, (_, i) => ({
      panel_number: i + 1,
      scene_description: `장면 ${i + 1}`,
      characters: ["CHARACTER_A"],
      expressions: ["웃음"],
      actions: [],
      dialogue: [{ character: "CHARACTER_A", text: "대사" }],
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
    temporaryLocations: [],
    panels: [
      {
        panel_number: 1,
        panel_type: "scene" as const,
        scene_description: "장면",
        character_ids: ["33333333-3333-4333-8333-333333333333"],
        expression: "웃음",
        dialogue: [{ id: "11111111-1111-4111-8111-111111111111", character_id: "33333333-3333-4333-8333-333333333333", text: "안녕" }],
        narration: null,
        image_prompt: "prompt",
        cover_title: null,
        cover_subtitle: null,
        location_id: null,
        time_of_day: null,
        temp_location_key: null,
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

  test("한 컷에 캐릭터가 4명 초과(5명)면 거부된다", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 1 });
    const extraIds = [
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",
      "77777777-7777-4777-8777-777777777777",
    ];
    getProjectCharactersMock.mockResolvedValue([
      ...PROJECT_CHARACTERS,
      ...extraIds.map((id) => ({ id, display_name: "기타", role: "단역", personality: null, speaking_style: null })),
    ]);
    const badDraft = {
      ...validDraft,
      panels: [
        {
          ...validDraft.panels[0],
          character_ids: ["33333333-3333-4333-8333-333333333333", ...extraIds],
          dialogue: [],
        },
      ],
    };
    const { saveStoryboardAction } = await import("../../lib/projects/storyboard");

    const result = await saveStoryboardAction("proj-1", badDraft);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/최대 4명/);
  });

  test("기존에 표지가 있던 프로젝트에서 표지를 빼고 저장하면 거부된다 (표지 삭제 방지)", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 2 });
    getProjectPanelsMock.mockResolvedValue([{ panel_type: "cover" }, { panel_type: "scene" }]);
    const draftWithoutCover = {
      ...validDraft,
      panels: [{ ...validDraft.panels[0] }, { ...validDraft.panels[0], panel_number: 2 }],
    };
    const { saveStoryboardAction } = await import("../../lib/projects/storyboard");

    const result = await saveStoryboardAction("proj-1", draftWithoutCover);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/표지/);
  });

  test("표지가 있는 draft를 저장하면 panel_type/cover_title이 함께 저장된다", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 2 });
    getProjectPanelsMock.mockResolvedValue([{ panel_type: "cover" }, { panel_type: "scene" }]);
    const draftWithCover = {
      ...validDraft,
      panels: [
        {
          ...validDraft.panels[0],
          panel_type: "cover" as const,
          cover_title: "표지 제목",
          cover_subtitle: "부제목",
        },
        { ...validDraft.panels[0], panel_number: 2 },
      ],
    };
    const { saveStoryboardAction } = await import("../../lib/projects/storyboard");

    const result = await saveStoryboardAction("proj-1", draftWithCover);
    expect(result.ok).toBe(true);
    const upsertCall = currentSupabase._calls["toon_panels.upsert"][0] as { rows: Record<string, unknown>[] };
    expect(upsertCall.rows[0].panel_type).toBe("cover");
    expect(upsertCall.rows[0].cover_title).toBe("표지 제목");
  });

  describe("022 — Temporary Location 저장(toon_save_storyboard_panels RPC)", () => {
    test("정의되지 않은 temp_location_key를 참조하는 panel은 거부되고 RPC를 호출하지 않는다", async () => {
      getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 1 });
      const badDraft = {
        ...validDraft,
        temporaryLocations: [],
        panels: [{ ...validDraft.panels[0], temp_location_key: "TEMP_A" }],
      };
      const { saveStoryboardAction } = await import("../../lib/projects/storyboard");

      const result = await saveStoryboardAction("proj-1", badDraft);
      expect(result.ok).toBe(false);
      expect(currentSupabase._calls["rpc.toon_save_storyboard_panels"]).toBeUndefined();
    });

    test("location_id와 temp_location_key를 동시에 지정하면 거부된다(상호배타)", async () => {
      getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 1 });
      const badDraft = {
        ...validDraft,
        temporaryLocations: [{ location_key: "TEMP_A", display_name: "카페", visual_prompt: "일반 카페 내부" }],
        panels: [{ ...validDraft.panels[0], location_id: "loc-x", temp_location_key: "TEMP_A" }],
      };
      const { saveStoryboardAction } = await import("../../lib/projects/storyboard");

      const result = await saveStoryboardAction("proj-1", badDraft);
      expect(result.ok).toBe(false);
      expect(currentSupabase._calls["rpc.toon_save_storyboard_panels"]).toBeUndefined();
    });

    test("정의된 temp_location_key를 참조하는 panel은 RPC에 temporaryLocations 정의와 함께 전달된다", async () => {
      getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 1 });
      const draft = {
        ...validDraft,
        temporaryLocations: [{ location_key: "TEMP_A", display_name: "카페", visual_prompt: "일반 카페 내부" }],
        panels: [{ ...validDraft.panels[0], temp_location_key: "TEMP_A" }],
      };
      const { saveStoryboardAction } = await import("../../lib/projects/storyboard");

      const result = await saveStoryboardAction("proj-1", draft);
      expect(result.ok).toBe(true);
      const rpcCalls = currentSupabase._calls["rpc.toon_save_storyboard_panels"] as Record<string, unknown>[];
      expect(rpcCalls).toHaveLength(1);
      expect(rpcCalls[0].p_temp_locations).toEqual(draft.temporaryLocations);
      const panelRows = rpcCalls[0].p_panel_rows as Record<string, unknown>[];
      expect(panelRows[0].temp_location_key).toBe("TEMP_A");
      expect(panelRows[0].location_id).toBeNull();
    });

    test("RPC가 오류를 반환하면 저장 실패로 처리되고 프로젝트 상태는 갱신되지 않는다", async () => {
      getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 1, status: "draft" });
      currentSupabase.rpc = async () => ({ error: { message: "db down" } });
      const { saveStoryboardAction } = await import("../../lib/projects/storyboard");

      const result = await saveStoryboardAction("proj-1", validDraft);
      expect(result.ok).toBe(false);
      expect(currentSupabase._calls["toon_projects.update"]).toBeUndefined();
    });

    test("레거시 프로젝트(temporaryLocations 빈 배열, temp_location_key 전부 null)도 정상 저장된다", async () => {
      getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 1 });
      const { saveStoryboardAction } = await import("../../lib/projects/storyboard");

      const result = await saveStoryboardAction("proj-1", validDraft);
      expect(result.ok).toBe(true);
      const rpcCalls = currentSupabase._calls["rpc.toon_save_storyboard_panels"] as Record<string, unknown>[];
      expect(rpcCalls[0].p_temp_locations).toEqual([]);
    });
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

describe("regenerateStoryboardWithSettingsAction — 2-phase (검증/AI 먼저, DB 반영은 마지막)", () => {
  const VALID_INPUT = {
    topic: "수정된 소재",
    panel_count: 10,
    character_ids: ["33333333-3333-4333-8333-333333333333"],
  };

  beforeEach(() => {
    getCharacterMock.mockImplementation(async (_supabase: unknown, id: string) => ({
      id,
      display_name: "엄마",
      role: "주인공",
      personality: null,
      speaking_style: null,
    }));
    // panelCount에 맞춰 항상 유효한 raw storyboard를 돌려주는 기본값 —
    // 개별 테스트가 실패를 흉내내고 싶으면 이 mock을 덮어쓴다.
    generateStoryboardMock.mockImplementation(async (input: { panelCount: number }) =>
      makeRawStoryboard(input.panelCount)
    );
  });

  test("타인 프로젝트는 수정할 수 없다", async () => {
    getProjectMock.mockResolvedValue(null);
    const { regenerateStoryboardWithSettingsAction } = await import("../../lib/projects/storyboard");

    const result = await regenerateStoryboardWithSettingsAction("someone-elses-project", VALID_INPUT);
    expect(result.ok).toBe(false);
    expect(generateStoryboardMock).not.toHaveBeenCalled();
  });

  test("completed 프로젝트는 바로 수정할 수 없다 (AI 호출 없음)", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, status: "completed" });
    const { regenerateStoryboardWithSettingsAction } = await import("../../lib/projects/storyboard");

    const result = await regenerateStoryboardWithSettingsAction("proj-1", VALID_INPUT);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/다시 편집하기/);
    expect(generateStoryboardMock).not.toHaveBeenCalled();
  });

  test("2장 미만은 AI 호출 없이 거부된다", async () => {
    const { regenerateStoryboardWithSettingsAction } = await import("../../lib/projects/storyboard");
    const result = await regenerateStoryboardWithSettingsAction("proj-1", { ...VALID_INPUT, panel_count: 1 });
    expect(result.ok).toBe(false);
    expect(generateStoryboardMock).not.toHaveBeenCalled();
  });

  test("20장 초과는 AI 호출 없이 거부된다", async () => {
    const { regenerateStoryboardWithSettingsAction } = await import("../../lib/projects/storyboard");
    const result = await regenerateStoryboardWithSettingsAction("proj-1", { ...VALID_INPUT, panel_count: 21 });
    expect(result.ok).toBe(false);
    expect(generateStoryboardMock).not.toHaveBeenCalled();
  });

  test("2장은 허용된다", async () => {
    const { regenerateStoryboardWithSettingsAction } = await import("../../lib/projects/storyboard");
    const result = await regenerateStoryboardWithSettingsAction("proj-1", { ...VALID_INPUT, panel_count: 2 });
    expect(result.ok).toBe(true);
  });

  test("20장은 허용된다", async () => {
    const { regenerateStoryboardWithSettingsAction } = await import("../../lib/projects/storyboard");
    const result = await regenerateStoryboardWithSettingsAction("proj-1", { ...VALID_INPUT, panel_count: 20 });
    expect(result.ok).toBe(true);
  });

  test("타인 캐릭터를 선택하면 AI 호출 없이 거부된다 (getCharacter가 null 반환)", async () => {
    getCharacterMock.mockResolvedValue(null);
    const { regenerateStoryboardWithSettingsAction } = await import("../../lib/projects/storyboard");

    const result = await regenerateStoryboardWithSettingsAction("proj-1", VALID_INPUT);
    expect(result.ok).toBe(false);
    expect(generateStoryboardMock).not.toHaveBeenCalled();
  });

  test("AI 생성 실패 시 DB에 아무 것도 쓰지 않는다 (topic/panel_count/panels/roster/이미지 전부 미변경)", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 10, topic: "기존 소재" });
    getProjectPanelsMock.mockResolvedValue([
      { panel_number: 1, panel_type: "scene", raw_image_url: "raw/1.png", image_url: "final/1.png" },
    ]);
    generateStoryboardMock.mockRejectedValue(new Error("AI 오류"));
    const { regenerateStoryboardWithSettingsAction } = await import("../../lib/projects/storyboard");

    const result = await regenerateStoryboardWithSettingsAction("proj-1", { ...VALID_INPUT, panel_count: 15 });
    expect(result.ok).toBe(false);
    expect(currentSupabase._calls["toon_projects.update"]).toBeUndefined();
    expect(currentSupabase._calls["toon_panels.upsert"]).toBeUndefined();
    expect(currentSupabase._calls["toon_panels.delete"]).toBeUndefined();
    expect(currentSupabase._calls["toon_project_characters.insert"]).toBeUndefined();
    expect(currentSupabase._calls["toon_project_characters.delete"]).toBeUndefined();
    // 기존 이미지(raw/final)도 Storage 정리 함수가 전혀 호출되지 않아 그대로 보존된다.
    expect(cleanupProjectStorageMock).not.toHaveBeenCalled();
  });

  test("컷수 감소로 삭제될 이미지가 있고 사용자가 동의했어도, AI 생성이 실패하면 Storage/DB 모두 미변경이다", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 15 });
    getProjectPanelsMock.mockResolvedValue([
      ...Array.from({ length: 10 }, (_, i) => ({ panel_number: i + 1, raw_image_url: null, image_url: null })),
      { panel_number: 11, raw_image_url: "raw/path.png", image_url: null },
    ]);
    generateStoryboardMock.mockRejectedValue(new Error("AI 오류"));
    const { regenerateStoryboardWithSettingsAction } = await import("../../lib/projects/storyboard");

    // confirmDiscardImages=true로 이미지 삭제에 동의한 상태에서도
    const result = await regenerateStoryboardWithSettingsAction("proj-1", { ...VALID_INPUT, panel_count: 10 }, true);
    expect(result.ok).toBe(false);
    // AI가 실패했으므로 동의를 받았더라도 실제 삭제/DB 반영은 절대 일어나지 않는다.
    expect(cleanupProjectStorageMock).not.toHaveBeenCalled();
    expect(currentSupabase._calls["toon_panels.delete"]).toBeUndefined();
    expect(currentSupabase._calls["toon_projects.update"]).toBeUndefined();
  });

  test("AI 결과 검증 실패(장수 불일치) 시에도 DB에 아무 것도 쓰지 않는다", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 10 });
    generateStoryboardMock.mockResolvedValue(makeRawStoryboard(6)); // 15장을 요청했는데 6장을 반환
    const { regenerateStoryboardWithSettingsAction } = await import("../../lib/projects/storyboard");

    const result = await regenerateStoryboardWithSettingsAction("proj-1", { ...VALID_INPUT, panel_count: 15 });
    expect(result.ok).toBe(false);
    expect(currentSupabase._calls["toon_projects.update"]).toBeUndefined();
    expect(currentSupabase._calls["toon_panels.upsert"]).toBeUndefined();
  });

  test("이미지가 있는 초과 컷을 삭제해야 하면 AI를 호출하지 않고 확인부터 요구한다", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 15 });
    getProjectPanelsMock.mockResolvedValue([
      ...Array.from({ length: 10 }, (_, i) => ({ panel_number: i + 1, raw_image_url: null, image_url: null })),
      ...Array.from({ length: 5 }, (_, i) => ({ panel_number: i + 11, raw_image_url: "raw/path.png", image_url: null })),
    ]);
    const { regenerateStoryboardWithSettingsAction } = await import("../../lib/projects/storyboard");

    const result = await regenerateStoryboardWithSettingsAction("proj-1", { ...VALID_INPUT, panel_count: 10 });
    expect(result.ok).toBe(false);
    expect(result.needsImageConfirmation).toBe(true);
    expect(result.affectedPanelNumbers).toEqual([11, 12, 13, 14, 15]);
    expect(generateStoryboardMock).not.toHaveBeenCalled();
    expect(currentSupabase._calls["toon_panels.delete"]).toBeUndefined();
    expect(currentSupabase._calls["toon_projects.update"]).toBeUndefined();
  });

  test("새 Storyboard 생성이 성공해야만 새 설정(topic/panel_count/story_summary)이 반영된다", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 10, topic: "기존 소재" });
    getProjectPanelsMock.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({ panel_number: i + 1, raw_image_url: null, image_url: null }))
    );
    const { regenerateStoryboardWithSettingsAction } = await import("../../lib/projects/storyboard");

    const result = await regenerateStoryboardWithSettingsAction("proj-1", { ...VALID_INPUT, panel_count: 15 });
    expect(result.ok).toBe(true);
    expect(result.draft?.panels).toHaveLength(15);
    const projectUpdates = currentSupabase._calls["toon_projects.update"] as Record<string, unknown>[];
    expect(projectUpdates[0]).toMatchObject({ topic: "수정된 소재", panel_count: 15 });
  });

  test("10 -> 15장 증가: 기존 panel을 지우지 않고 panel_count를 먼저 올린 뒤 저장한다", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 10 });
    getProjectPanelsMock.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({ panel_number: i + 1, raw_image_url: null, image_url: null }))
    );
    const { regenerateStoryboardWithSettingsAction } = await import("../../lib/projects/storyboard");

    const result = await regenerateStoryboardWithSettingsAction("proj-1", { ...VALID_INPUT, panel_count: 15 });
    expect(result.ok).toBe(true);
    expect(currentSupabase._calls["toon_panels.delete"]).toBeUndefined();
    expect(currentSupabase._calls["toon_panels.upsert"]).toBeDefined();
  });

  test("15 -> 10장 감소: 이미지 없는 초과 컷은 확인 없이 바로 삭제되고 저장된다", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 15 });
    getProjectPanelsMock.mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => ({ panel_number: i + 1, raw_image_url: null, image_url: null }))
    );
    const { regenerateStoryboardWithSettingsAction } = await import("../../lib/projects/storyboard");

    const result = await regenerateStoryboardWithSettingsAction("proj-1", { ...VALID_INPUT, panel_count: 10 });
    expect(result.ok).toBe(true);
    expect(currentSupabase._calls["toon_panels.delete"]).toHaveLength(1);
    expect(currentSupabase._calls["toon_panels.gt"]).toContainEqual({ col: "panel_number", val: 10 });
    expect(currentSupabase._calls["toon_panels.upsert"]).toBeDefined();
  });

  test("이미지가 있어도 confirmDiscardImages=true면 AI 성공 후 Storage 정리 함수가 호출되고 진행된다", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 15 });
    getProjectPanelsMock.mockResolvedValue([
      ...Array.from({ length: 10 }, (_, i) => ({ panel_number: i + 1, raw_image_url: null, image_url: null })),
      { panel_number: 11, raw_image_url: "raw/path.png", image_url: null },
    ]);
    const { regenerateStoryboardWithSettingsAction } = await import("../../lib/projects/storyboard");

    const result = await regenerateStoryboardWithSettingsAction("proj-1", { ...VALID_INPUT, panel_count: 10 }, true);
    expect(result.ok).toBe(true);
    expect(generateStoryboardMock).toHaveBeenCalled();
    expect(cleanupProjectStorageMock).toHaveBeenCalledWith(currentSupabase, "user-a", "proj-1", [11]);
    expect(currentSupabase._calls["toon_panels.delete"]).toHaveLength(1);
  });

  test("등장인물 목록을 바꾸면 toon_characters/toon_character_sheets는 건드리지 않고 toon_project_characters만 동기화한다", async () => {
    const KEEP_ID = "33333333-3333-4333-8333-333333333333";
    const OLD_ID = "44444444-4444-4444-8444-444444444444";
    const NEW_ID = "55555555-5555-4555-8555-555555555555";
    getProjectCharactersMock.mockResolvedValue([
      { id: KEEP_ID, display_name: "엄마" },
      { id: OLD_ID, display_name: "제거될 캐릭터" },
    ]);
    const { regenerateStoryboardWithSettingsAction } = await import("../../lib/projects/storyboard");

    const result = await regenerateStoryboardWithSettingsAction("proj-1", {
      ...VALID_INPUT,
      character_ids: [KEEP_ID, NEW_ID],
    });
    expect(result.ok).toBe(true);
    expect(currentSupabase._calls["toon_project_characters.in"]).toContainEqual({
      col: "character_id",
      val: [OLD_ID],
    });
    expect(currentSupabase._calls["toon_project_characters.insert"]).toEqual([
      [{ project_id: "proj-1", character_id: NEW_ID }],
    ]);
    expect(currentSupabase._calls["toon_characters.insert"]).toBeUndefined();
    expect(currentSupabase._calls["toon_character_sheets.insert"]).toBeUndefined();
  });

  test("성공 시 CHARACTER_A identifier가 실제 character_id로 변환되어 panel.character_ids에 저장된다", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, panel_count: 10 });
    const { regenerateStoryboardWithSettingsAction } = await import("../../lib/projects/storyboard");

    const result = await regenerateStoryboardWithSettingsAction("proj-1", VALID_INPUT);
    expect(result.ok).toBe(true);
    const upsertCall = currentSupabase._calls["toon_panels.upsert"][0] as { rows: Record<string, unknown>[] };
    for (const row of upsertCall.rows) {
      for (const cid of row.character_ids as string[]) {
        expect(cid).toBe("33333333-3333-4333-8333-333333333333");
        expect(cid).not.toMatch(/^CHARACTER_/);
      }
    }
  });
});
