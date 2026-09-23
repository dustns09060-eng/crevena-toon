import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const getProjectMock = vi.fn();
const getProjectPanelsMock = vi.fn();
vi.mock("../../lib/projects/service", () => ({
  getProject: (...args: unknown[]) => getProjectMock(...args),
  getProjectPanels: (...args: unknown[]) => getProjectPanelsMock(...args),
}));

const getCharacterMock = vi.fn();
vi.mock("../../lib/characters/service", () => ({
  getCharacter: (...args: unknown[]) => getCharacterMock(...args),
}));

const getLocationMock = vi.fn();
vi.mock("../../lib/locations/service", () => ({
  getLocation: (...args: unknown[]) => getLocationMock(...args),
}));

const generateMock = vi.fn();
vi.mock("../../src/providers/characterSheetProviderRegistry", () => ({
  getCharacterSheetProvider: () => ({ id: "gemini", generate: generateMock }),
}));

interface MockConfig {
  panel: Record<string, unknown>;
  approvedSheetStoragePath?: string | null;
  downloadOk?: boolean;
  existingImageCount?: number;
  targetPanelImage?: Record<string, unknown> | null;
}

function createSupabaseMock(config: MockConfig) {
  const calls: Record<string, unknown[]> = {};
  function record(key: string, arg?: unknown) {
    (calls[key] ??= []).push(arg);
  }

  function makeBuilder(table: string) {
    let insertPayload: Record<string, unknown> | undefined;
    let selectOpts: { count?: string } | undefined;

    const builder: Record<string, unknown> = {
      select(cols: string, opts?: { count?: string }) {
        record(`${table}.select`, { cols, opts });
        selectOpts = opts;
        return builder;
      },
      insert(payload: Record<string, unknown>) {
        record(`${table}.insert`, payload);
        insertPayload = payload;
        return builder;
      },
      update(payload: Record<string, unknown>) {
        record(`${table}.update`, payload);
        return builder;
      },
      eq(col: string, val: unknown) {
        record(`${table}.eq`, { col, val });
        return builder;
      },
      neq(col: string, val: unknown) {
        record(`${table}.neq`, { col, val });
        return builder;
      },
      maybeSingle() {
        if (table === "toon_panels") return Promise.resolve({ data: config.panel, error: null });
        if (table === "toon_character_sheets") {
          if (!config.approvedSheetStoragePath) return Promise.resolve({ data: null, error: null });
          return Promise.resolve({
            data: { id: "sheet-1", storage_path: config.approvedSheetStoragePath },
            error: null,
          });
        }
        if (table === "toon_panel_images") {
          return Promise.resolve({ data: config.targetPanelImage ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      single() {
        if (table === "toon_generations" && insertPayload) {
          return Promise.resolve({ data: { id: "gen-1" }, error: null });
        }
        if (table === "toon_panel_images" && insertPayload) {
          return Promise.resolve({
            data: {
              id: "img-1",
              status: "candidate",
              storage_path: insertPayload.storage_path,
              generation_version: insertPayload.generation_version,
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve: (v: { count?: number; error: null }) => void) {
        if (table === "toon_panel_images" && selectOpts?.count === "exact") {
          resolve({ count: config.existingImageCount ?? 0, error: null });
          return;
        }
        resolve({ error: null });
      },
    };
    return builder;
  }

  return {
    _calls: calls,
    auth: { getUser: async () => ({ data: { user: OWNED_USER } }) },
    storage: {
      from(bucket: string) {
        return {
          download: async (path: string) => {
            record(`storage.${bucket}.download`, path);
            if (config.downloadOk === false) return { data: null, error: new Error("boom") };
            return {
              data: { type: "image/png", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer },
              error: null,
            };
          },
          upload: async (path: string) => {
            record(`storage.${bucket}.upload`, path);
            return { error: null };
          },
          createSignedUrl: async (path: string) => {
            record(`storage.${bucket}.createSignedUrl`, path);
            return { data: { signedUrl: "https://signed.example/" + path }, error: null };
          },
        };
      },
    },
    from: (t: string) => makeBuilder(t),
  };
}

const OWNED_USER = { id: "user-a" };
const OWNED_PROJECT = { id: "proj-1", user_id: "user-a", panel_count: 1, status: "confirmed" };
const OWNED_PANEL = {
  id: "panel-1",
  project_id: "proj-1",
  panel_number: 1,
  character_ids: ["char-a"],
  scene: "거실 장면",
  expression: "웃음",
  image_prompt: "living room, medium shot",
  dialogue: [{ id: "d1", character_id: "char-a", text: "엄마 대사입니다" }],
  narration: "내레이션 문장",
};
const CHARACTER_WITH_BIBLE = {
  id: "char-a",
  display_name: "엄마",
  hairstyle: "짧은 단발머리",
  hair_color: "검은색",
  face_features: "둥근 얼굴형",
  body_type: "보통 체형",
  representative_outfit: "검은 티셔츠",
  distinctive_features: null,
  visual_prompt: "30대 여성",
  negative_constraints: ["머리색을 바꾸지 않는다"],
};
const CHARACTER_WITHOUT_BIBLE = { ...CHARACTER_WITH_BIBLE, hairstyle: null };

let currentSupabase: ReturnType<typeof createSupabaseMock>;
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => currentSupabase,
}));
vi.mock("../../lib/supabase/admin", () => ({
  createAdminClient: () => currentSupabase,
}));

beforeEach(() => {
  vi.clearAllMocks();
  currentSupabase = createSupabaseMock({ panel: OWNED_PANEL, approvedSheetStoragePath: "user-a/char-a/sheet.png" });
  getProjectMock.mockResolvedValue(OWNED_PROJECT);
  getProjectPanelsMock.mockResolvedValue([OWNED_PANEL]);
  getCharacterMock.mockResolvedValue(CHARACTER_WITH_BIBLE);
  getLocationMock.mockResolvedValue({
    id: "loc-a",
    display_name: "우리 집 거실",
    visual_prompt: "따뜻한 거실",
    wall_and_floor: null,
    fixed_furniture: null,
    window_style: null,
    recurring_props: null,
    distinctive_features: null,
  });
  generateMock.mockResolvedValue({ imageBytes: Buffer.from([1, 2, 3]), provider: "gemini", model: "gemini-2.5-flash-image" });
});

describe("generatePanelImageAction", () => {
  test("타인 소유(또는 존재하지 않는) panel/project는 거부된다", async () => {
    getProjectMock.mockResolvedValue(null);
    const { generatePanelImageAction } = await import("../../lib/projects/panelImages");

    const result = await generatePanelImageAction("panel-1");
    expect(result.ok).toBe(false);
    expect(generateMock).not.toHaveBeenCalled();
  });

  test("프로젝트가 confirmed가 아니면 생성이 차단된다", async () => {
    getProjectMock.mockResolvedValue({ ...OWNED_PROJECT, status: "storyboard" });
    const { generatePanelImageAction } = await import("../../lib/projects/panelImages");

    const result = await generatePanelImageAction("panel-1");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/확정/);
    expect(generateMock).not.toHaveBeenCalled();
  });

  test("등장 캐릭터에 저장된 Character Bible이 없으면 차단된다", async () => {
    getCharacterMock.mockResolvedValue(CHARACTER_WITHOUT_BIBLE);
    const { generatePanelImageAction } = await import("../../lib/projects/panelImages");

    const result = await generatePanelImageAction("panel-1");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Character Bible/);
    expect(generateMock).not.toHaveBeenCalled();
  });

  test("승인된 Character Sheet가 없으면 차단된다", async () => {
    currentSupabase = createSupabaseMock({ panel: OWNED_PANEL, approvedSheetStoragePath: null });
    const { generatePanelImageAction } = await import("../../lib/projects/panelImages");

    const result = await generatePanelImageAction("panel-1");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Character Sheet/);
    expect(generateMock).not.toHaveBeenCalled();
  });

  test("조건을 모두 만족하면 candidate 이미지가 생성되고 provider는 정확히 1번만 호출된다", async () => {
    const { generatePanelImageAction } = await import("../../lib/projects/panelImages");

    const result = await generatePanelImageAction("panel-1");
    expect(result.ok).toBe(true);
    expect(result.image?.status).toBe("candidate");
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  test("dialogue/narration 문자열이 최종 image prompt에 포함되지 않는다", async () => {
    const { generatePanelImageAction } = await import("../../lib/projects/panelImages");

    await generatePanelImageAction("panel-1");
    const promptSentToProvider = generateMock.mock.calls[0][0] as string;
    expect(promptSentToProvider).not.toContain("엄마 대사입니다");
    expect(promptSentToProvider).not.toContain("내레이션 문장");
  });

  test("panel_type='cover'면 표지 전용 안내(COVER_COMPOSITION_NOTE)가 prompt에 포함된다", async () => {
    const coverPanel = { ...OWNED_PANEL, panel_type: "cover" as const };
    currentSupabase = createSupabaseMock({ panel: coverPanel, approvedSheetStoragePath: "user-a/char-a/sheet.png" });
    getProjectPanelsMock.mockResolvedValue([coverPanel]);
    const { generatePanelImageAction } = await import("../../lib/projects/panelImages");

    await generatePanelImageAction("panel-1");
    const promptSentToProvider = generateMock.mock.calls[0][0] as string;
    expect(promptSentToProvider).toMatch(/COVER image for the whole episode/);
  });

  test("panel_type='scene'(본문)이면 표지 전용 안내가 prompt에 없다", async () => {
    const { generatePanelImageAction } = await import("../../lib/projects/panelImages");

    await generatePanelImageAction("panel-1");
    const promptSentToProvider = generateMock.mock.calls[0][0] as string;
    expect(promptSentToProvider).not.toMatch(/COVER image for the whole episode/);
  });

  test("등장인물이 4명 초과인 컷은 명확한 메시지와 함께 차단된다", async () => {
    const overCrowdedPanel = { ...OWNED_PANEL, character_ids: ["char-a", "char-b", "char-c", "char-d", "char-e"] };
    getProjectPanelsMock.mockResolvedValue([overCrowdedPanel]);
    currentSupabase = createSupabaseMock({ panel: overCrowdedPanel, approvedSheetStoragePath: "user-a/char-a/sheet.png" });
    const { generatePanelImageAction } = await import("../../lib/projects/panelImages");

    const result = await generatePanelImageAction("panel-1");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/최대 4명/);
    expect(generateMock).not.toHaveBeenCalled();
  });

  test("이미지 생성 실패 시 toon_panel_images에 아무것도 저장하지 않는다", async () => {
    generateMock.mockRejectedValue(new Error("provider boom"));
    const { generatePanelImageAction } = await import("../../lib/projects/panelImages");

    const result = await generatePanelImageAction("panel-1");
    expect(result.ok).toBe(false);
    expect(currentSupabase._calls["toon_panel_images.insert"]).toBeUndefined();
  });

  test("생성 성공을 로그로 남긴다", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { generatePanelImageAction } = await import("../../lib/projects/panelImages");

    await generatePanelImageAction("panel-1");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("status=success"));
    logSpy.mockRestore();
  });

  test("생성 실패를 로그로 남긴다 (pending으로 방치되지 않음)", async () => {
    generateMock.mockRejectedValue(new Error("boom"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { generatePanelImageAction } = await import("../../lib/projects/panelImages");

    await generatePanelImageAction("panel-1");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("status=failed"));
    const genUpdates = currentSupabase._calls["toon_generations.update"] as Record<string, unknown>[];
    expect(genUpdates.some((u) => u.status === "failed")).toBe(true);
    logSpy.mockRestore();
  });

  test("새 candidate 생성 성공 시 같은 패널의 기존 candidate는 rejected로, approved는 건드리지 않는다 (STEP 7 §0.A)", async () => {
    const { generatePanelImageAction } = await import("../../lib/projects/panelImages");

    const result = await generatePanelImageAction("panel-1");
    expect(result.ok).toBe(true);

    const updates = currentSupabase._calls["toon_panel_images.update"] as Record<string, unknown>[];
    expect(updates).toContainEqual({ status: "rejected" });
    // approved로 전환하는 update는 이 액션에서 절대 호출되지 않는다.
    expect(updates.every((u) => u.status !== "approved")).toBe(true);

    const eqCalls = currentSupabase._calls["toon_panel_images.eq"] as { col: string; val: unknown }[];
    expect(eqCalls).toContainEqual({ col: "panel_id", val: "panel-1" });
    expect(eqCalls).toContainEqual({ col: "status", val: "candidate" });

    const neqCalls = currentSupabase._calls["toon_panel_images.neq"] as { col: string; val: unknown }[];
    expect(neqCalls).toContainEqual({ col: "id", val: "img-1" });
  });

  test("동시에 같은 컷을 두 번 요청하면 두 번째는 즉시 거부된다 (중복 요청 방지)", async () => {
    let resolveGen: (v: { imageBytes: Buffer; provider: string; model: string }) => void;
    generateMock.mockReturnValue(
      new Promise((resolve) => {
        resolveGen = resolve;
      })
    );
    const { generatePanelImageAction } = await import("../../lib/projects/panelImages");

    const first = generatePanelImageAction("panel-1");
    await new Promise((r) => setTimeout(r, 0));
    const second = await generatePanelImageAction("panel-1");

    expect(second.ok).toBe(false);
    expect(second.message).toMatch(/이미/);

    resolveGen!({ imageBytes: Buffer.from([1]), provider: "gemini", model: "m" });
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
  });
});

describe("approvePanelImageAction", () => {
  test("타인 panel은 승인할 수 없다", async () => {
    getProjectMock.mockResolvedValue(null);
    const { approvePanelImageAction } = await import("../../lib/projects/panelImages");

    const result = await approvePanelImageAction("panel-1", "img-1");
    expect(result.ok).toBe(false);
  });

  test("존재하지 않는 이미지 승인은 거부된다", async () => {
    currentSupabase = createSupabaseMock({ panel: OWNED_PANEL, targetPanelImage: null });
    const { approvePanelImageAction } = await import("../../lib/projects/panelImages");

    const result = await approvePanelImageAction("panel-1", "does-not-exist");
    expect(result.ok).toBe(false);
  });

  test("승인 시 기존 approved를 먼저 내리고 새 후보를 승인한 뒤 panel.raw_image_url을 갱신한다", async () => {
    currentSupabase = createSupabaseMock({
      panel: OWNED_PANEL,
      targetPanelImage: { id: "img-2", storage_path: "user-a/proj-1/raw/1/gen-2.png", panel_id: "panel-1" },
    });
    const { approvePanelImageAction } = await import("../../lib/projects/panelImages");

    const result = await approvePanelImageAction("panel-1", "img-2");
    expect(result.ok).toBe(true);

    const updates = currentSupabase._calls["toon_panel_images.update"] as Record<string, unknown>[];
    expect(updates[0]).toEqual({ status: "rejected" });
    expect(updates[1]).toEqual({ status: "approved" });

    const panelUpdates = currentSupabase._calls["toon_panels.update"] as Record<string, unknown>[];
    expect(panelUpdates[0]).toEqual({ raw_image_url: "user-a/proj-1/raw/1/gen-2.png" });
  });
});

describe("updatePanelLocationAction — 021, 기존(확정된) panel에 Location/Time of Day 수동 지정", () => {
  test("타인 panel은 수정할 수 없다", async () => {
    getProjectMock.mockResolvedValue(null);
    const { updatePanelLocationAction } = await import("../../lib/projects/panelImages");

    const result = await updatePanelLocationAction("panel-1", { location_id: "loc-a", time_of_day: "NIGHT" });
    expect(result.ok).toBe(false);
  });

  test("타인 장소는 지정할 수 없다 (getLocation이 null 반환)", async () => {
    getLocationMock.mockResolvedValue(null);
    const { updatePanelLocationAction } = await import("../../lib/projects/panelImages");

    const result = await updatePanelLocationAction("panel-1", { location_id: "loc-a", time_of_day: null });
    expect(result.ok).toBe(false);
  });

  test("잘못된 time_of_day 값은 거부된다", async () => {
    const { updatePanelLocationAction } = await import("../../lib/projects/panelImages");

    const result = await updatePanelLocationAction("panel-1", {
      location_id: null,
      // @ts-expect-error 잘못된 값 테스트
      time_of_day: "MIDNIGHT_SNACK",
    });
    expect(result.ok).toBe(false);
  });

  test("정상 입력이면 location_id/time_of_day만 갱신하고 다른 것(Storyboard/캐릭터/이미지)은 건드리지 않는다", async () => {
    const { updatePanelLocationAction } = await import("../../lib/projects/panelImages");

    const result = await updatePanelLocationAction("panel-1", { location_id: "loc-a", time_of_day: "NIGHT" });
    expect(result.ok).toBe(true);
    expect(currentSupabase._calls["toon_panels.update"]).toEqual([{ location_id: "loc-a", time_of_day: "NIGHT" }]);
    expect(currentSupabase._calls["toon_panel_images.insert"]).toBeUndefined();
    expect(currentSupabase._calls["toon_characters.update"]).toBeUndefined();
  });

  test("location_id를 null로 지정해 장소 연결을 해제할 수 있다", async () => {
    const { updatePanelLocationAction } = await import("../../lib/projects/panelImages");

    const result = await updatePanelLocationAction("panel-1", { location_id: null, time_of_day: null });
    expect(result.ok).toBe(true);
    expect(currentSupabase._calls["toon_panels.update"]).toEqual([{ location_id: null, time_of_day: null }]);
    // location_id가 null이면 getLocation 조회 자체를 하지 않는다.
    expect(getLocationMock).not.toHaveBeenCalled();
  });
});
