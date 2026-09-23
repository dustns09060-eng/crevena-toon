import { beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const getProjectMock = vi.fn();
const getProjectPanelsMock = vi.fn();
const getProjectCharactersMock = vi.fn();
vi.mock("../../lib/projects/service", () => ({
  getProject: (...args: unknown[]) => getProjectMock(...args),
  getProjectPanels: (...args: unknown[]) => getProjectPanelsMock(...args),
  getProjectCharacters: (...args: unknown[]) => getProjectCharactersMock(...args),
}));

interface MockConfig {
  panel?: Record<string, unknown> | null;
}

function createSupabaseMock(config: MockConfig = {}) {
  const calls: Record<string, unknown[]> = {};
  function record(key: string, arg?: unknown) {
    (calls[key] ??= []).push(arg);
  }

  function makeBuilder(table: string) {
    const builder: Record<string, unknown> = {
      select() {
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
      maybeSingle() {
        if (table === "toon_panels") return Promise.resolve({ data: config.panel ?? null, error: null });
        return Promise.resolve({ data: null, error: null });
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
    storage: {
      from(bucket: string) {
        return {
          upload: async (uploadPath: string, _bytes: unknown, _opts: unknown) => {
            record(`storage.${bucket}.upload`, uploadPath);
            return { error: null };
          },
          remove: async (paths: string[]) => {
            record(`storage.${bucket}.remove`, paths);
            return { error: null };
          },
          createSignedUrl: async (signPath: string) => {
            record(`storage.${bucket}.createSignedUrl`, signPath);
            return { data: { signedUrl: "https://signed.example/" + signPath }, error: null };
          },
        };
      },
    },
    from: (t: string) => makeBuilder(t),
  };
}

const OWNED_USER = { id: "user-a" };
const OWNED_PROJECT = { id: "proj-1", user_id: "user-a", panel_count: 1, status: "confirmed" };

const CHAR_A = "11111111-1111-4111-8111-111111111111";
const DIALOGUE_ID = "22222222-2222-4222-8222-222222222222";

const APPROVED_PANEL = {
  id: "panel-1",
  project_id: "proj-1",
  panel_number: 1,
  panel_type: "scene",
  character_ids: [CHAR_A],
  raw_image_url: "user-a/proj-1/raw/1/gen-1.png",
  image_url: null,
  dialogue: [{ id: DIALOGUE_ID, character_id: CHAR_A, text: "안녕", bubble_type: "speech", bubble: null }],
  narration: "내레이션",
  narration_bubble: null,
  cover_title: null,
  cover_subtitle: null,
  cover_title_bubble: null,
};

const COVER_PANEL = {
  ...APPROVED_PANEL,
  id: "panel-cover",
  panel_number: 1,
  panel_type: "cover",
  dialogue: [],
  narration: null,
  cover_title: "육퇴하면 쉴 줄 알았지?",
  cover_subtitle: "체험단 마감이라는 진짜 최종 보스의 등장",
  cover_title_bubble: null,
};

function makePngFile(bytes: number[]): File {
  return new File([new Uint8Array(bytes)], "final.png", { type: "image/png" });
}

let currentSupabase: ReturnType<typeof createSupabaseMock>;
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => currentSupabase,
}));

beforeEach(() => {
  vi.clearAllMocks();
  currentSupabase = createSupabaseMock({ panel: APPROVED_PANEL });
  getProjectMock.mockResolvedValue(OWNED_PROJECT);
  getProjectPanelsMock.mockResolvedValue([APPROVED_PANEL]);
  getProjectCharactersMock.mockResolvedValue([{ id: CHAR_A, display_name: "엄마" }]);
});

describe("editor.ts는 AI provider를 절대 import하지 않는다 (STEP 7 §12)", () => {
  test("소스 코드에 provider registry/AI 관련 import가 없다", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../lib/projects/editor.ts"), "utf-8");
    expect(source).not.toMatch(/providers\//);
    expect(source).not.toMatch(/ProviderRegistry/);
    expect(source).not.toMatch(/generate\(/);
  });
});

describe("checkEditorReadiness", () => {
  test("모든 컷에 raw_image_url이 있어야 ready=true", async () => {
    const { checkEditorReadiness } = await import("../../lib/projects/editorUtils");
    const result = checkEditorReadiness(OWNED_PROJECT as never, [APPROVED_PANEL as never]);
    expect(result.ready).toBe(true);
  });

  test("승인되지 않은(raw_image_url 없는) 컷이 있으면 ready=false", async () => {
    const { checkEditorReadiness } = await import("../../lib/projects/editorUtils");
    const notApproved = { ...APPROVED_PANEL, raw_image_url: null };
    const result = checkEditorReadiness(OWNED_PROJECT as never, [notApproved as never]);
    expect(result.ready).toBe(false);
    expect(result.errors.join()).toMatch(/승인/);
  });

  test("프로젝트가 없으면 ready=false", async () => {
    const { checkEditorReadiness } = await import("../../lib/projects/editorUtils");
    const result = checkEditorReadiness(null, [APPROVED_PANEL as never]);
    expect(result.ready).toBe(false);
  });
});

describe("getPanelEditorData", () => {
  test("타인/존재하지 않는 프로젝트는 거부된다", async () => {
    getProjectMock.mockResolvedValue(null);
    const { getPanelEditorData } = await import("../../lib/projects/editor");

    const result = await getPanelEditorData("proj-1");
    expect(result.ok).toBe(false);
  });

  test("승인되지 않은 컷이 있으면 진입이 차단된다 (서버 측 강제)", async () => {
    getProjectPanelsMock.mockResolvedValue([{ ...APPROVED_PANEL, raw_image_url: null }]);
    const { getPanelEditorData } = await import("../../lib/projects/editor");

    const result = await getPanelEditorData("proj-1");
    expect(result.ok).toBe(false);
  });

  test("bubble이 null인 대사는 기본 배치를 계산해서 채워준다", async () => {
    const { getPanelEditorData } = await import("../../lib/projects/editor");

    const result = await getPanelEditorData("proj-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.panels[0].dialogue[0].bubble).not.toBeNull();
      expect(result.panels[0].narrationBubble).not.toBeNull();
    }
  });

  test("이미 bubble이 저장되어 있으면 기본값으로 덮어쓰지 않는다", async () => {
    const savedBubble = { x: 0.2, y: 0.2, width: 0.3, height: 0.1, tail_direction: "none" as const };
    getProjectPanelsMock.mockResolvedValue([
      {
        ...APPROVED_PANEL,
        dialogue: [{ id: DIALOGUE_ID, character_id: CHAR_A, text: "안녕", bubble_type: "speech", bubble: savedBubble }],
      },
    ]);
    const { getPanelEditorData } = await import("../../lib/projects/editor");

    const result = await getPanelEditorData("proj-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.panels[0].dialogue[0].bubble).toEqual(savedBubble);
    }
  });
});

describe("saveBubbleLayoutAction", () => {
  test("타인 소유 패널은 거부된다", async () => {
    currentSupabase = createSupabaseMock({ panel: null });
    const { saveBubbleLayoutAction } = await import("../../lib/projects/editor");

    const result = await saveBubbleLayoutAction("panel-1", [], null, null);
    expect(result.ok).toBe(false);
  });

  test("정상 dialogue/narration은 toon_panels에 저장된다", async () => {
    const { saveBubbleLayoutAction } = await import("../../lib/projects/editor");
    const dialogue = [
      {
        id: DIALOGUE_ID,
        character_id: CHAR_A,
        text: "수정된 대사",
        bubble_type: "speech" as const,
        bubble: { x: 0.1, y: 0.1, width: 0.3, height: 0.1, tail_direction: "none" as const },
      },
    ];

    const result = await saveBubbleLayoutAction("panel-1", dialogue, "새 내레이션", null);
    expect(result.ok).toBe(true);
    const updates = currentSupabase._calls["toon_panels.update"] as Record<string, unknown>[];
    expect(updates[0]).toEqual({ dialogue, narration: "새 내레이션", narration_bubble: null });
  });

  test("프로젝트에 연결되지 않은 character_id가 있으면 거부된다", async () => {
    const { saveBubbleLayoutAction } = await import("../../lib/projects/editor");
    const dialogue = [
      {
        id: DIALOGUE_ID,
        character_id: "99999999-9999-4999-8999-999999999999",
        text: "대사",
        bubble_type: "speech" as const,
        bubble: { x: 0.1, y: 0.1, width: 0.3, height: 0.1, tail_direction: "none" as const },
      },
    ];

    const result = await saveBubbleLayoutAction("panel-1", dialogue, null, null);
    expect(result.ok).toBe(false);
  });

  test("경계를 벗어난 bubble 좌표(x+width>1)는 거부된다", async () => {
    const { saveBubbleLayoutAction } = await import("../../lib/projects/editor");
    const dialogue = [
      {
        id: DIALOGUE_ID,
        character_id: CHAR_A,
        text: "대사",
        bubble_type: "speech" as const,
        bubble: { x: 0.8, y: 0.1, width: 0.5, height: 0.1, tail_direction: "none" as const },
      },
    ];

    const result = await saveBubbleLayoutAction("panel-1", dialogue, null, null);
    expect(result.ok).toBe(false);
  });
});

describe("getPanelEditorData — 표지(cover) 패널 필드", () => {
  test("scene 패널은 panelType='scene'이고 coverTitleBubble이 null이다", async () => {
    const { getPanelEditorData } = await import("../../lib/projects/editor");

    const result = await getPanelEditorData("proj-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.panels[0].panelType).toBe("scene");
      expect(result.panels[0].coverTitleBubble).toBeNull();
    }
  });

  test("cover_title이 있는 cover 패널은 coverTitleBubble이 null이면 기본 배치를 계산해 채워준다", async () => {
    getProjectPanelsMock.mockResolvedValue([COVER_PANEL]);
    const { getPanelEditorData } = await import("../../lib/projects/editor");

    const result = await getPanelEditorData("proj-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.panels[0].panelType).toBe("cover");
      expect(result.panels[0].coverTitle).toBe("육퇴하면 쉴 줄 알았지?");
      expect(result.panels[0].coverSubtitle).toBe("체험단 마감이라는 진짜 최종 보스의 등장");
      expect(result.panels[0].coverTitleBubble).not.toBeNull();
    }
  });

  test("이미 cover_title_bubble이 저장되어 있으면 기본값으로 덮어쓰지 않는다", async () => {
    const savedBubble = { x: 0.1, y: 0.02, width: 0.8, height: 0.2, font_size: 50 };
    getProjectPanelsMock.mockResolvedValue([{ ...COVER_PANEL, cover_title_bubble: savedBubble }]);
    const { getPanelEditorData } = await import("../../lib/projects/editor");

    const result = await getPanelEditorData("proj-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.panels[0].coverTitleBubble).toEqual(savedBubble);
    }
  });

  test("cover_title이 아직 없는 cover 패널은 coverTitleBubble도 null로 둔다(억지로 기본값을 만들지 않음)", async () => {
    getProjectPanelsMock.mockResolvedValue([{ ...COVER_PANEL, cover_title: null }]);
    const { getPanelEditorData } = await import("../../lib/projects/editor");

    const result = await getPanelEditorData("proj-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.panels[0].coverTitleBubble).toBeNull();
    }
  });
});

describe("saveCoverLayoutAction", () => {
  test("타인 소유 패널은 거부된다", async () => {
    currentSupabase = createSupabaseMock({ panel: null });
    const { saveCoverLayoutAction } = await import("../../lib/projects/editor");

    const result = await saveCoverLayoutAction("panel-cover", "제목", "부제", null);
    expect(result.ok).toBe(false);
  });

  test("경계를 벗어난 cover_title_bubble(x+width>1)은 거부된다", async () => {
    currentSupabase = createSupabaseMock({ panel: COVER_PANEL });
    const { saveCoverLayoutAction } = await import("../../lib/projects/editor");

    const result = await saveCoverLayoutAction("panel-cover", "제목", "부제", {
      x: 0.8,
      y: 0.05,
      width: 0.5,
      height: 0.15,
    });
    expect(result.ok).toBe(false);
  });

  test("정상 title/subtitle/bubble은 cover 전용 컬럼 3개만 저장한다(dialogue/narration은 건드리지 않음)", async () => {
    currentSupabase = createSupabaseMock({ panel: COVER_PANEL });
    const { saveCoverLayoutAction } = await import("../../lib/projects/editor");

    const bubble = { x: 0.08, y: 0.04, width: 0.84, height: 0.18, font_size: 44 };
    const result = await saveCoverLayoutAction("panel-cover", "육퇴하면 쉴 줄 알았지?", "체험단 마감이라는 진짜 최종 보스의 등장", bubble);
    expect(result.ok).toBe(true);

    const updates = currentSupabase._calls["toon_panels.update"] as Record<string, unknown>[];
    expect(updates[0]).toEqual({
      cover_title: "육퇴하면 쉴 줄 알았지?",
      cover_subtitle: "체험단 마감이라는 진짜 최종 보스의 등장",
      cover_title_bubble: bubble,
    });
  });

  test("coverTitleBubble이 null이어도 저장할 수 있다(아직 배치 전 상태)", async () => {
    currentSupabase = createSupabaseMock({ panel: COVER_PANEL });
    const { saveCoverLayoutAction } = await import("../../lib/projects/editor");

    const result = await saveCoverLayoutAction("panel-cover", "제목", null, null);
    expect(result.ok).toBe(true);
  });
});

describe("saveFinalRenderAction", () => {
  test("타인 소유 패널은 거부된다", async () => {
    currentSupabase = createSupabaseMock({ panel: null });
    const { saveFinalRenderAction } = await import("../../lib/projects/editor");

    const result = await saveFinalRenderAction("panel-1", makePngFile([1, 2, 3]));
    expect(result.ok).toBe(false);
  });

  test("승인된 원본 이미지가 없는 컷은 최종 렌더가 거부된다", async () => {
    currentSupabase = createSupabaseMock({ panel: { ...APPROVED_PANEL, raw_image_url: null } });
    const { saveFinalRenderAction } = await import("../../lib/projects/editor");

    const result = await saveFinalRenderAction("panel-1", makePngFile([1, 2, 3]));
    expect(result.ok).toBe(false);
  });

  test("final/ 경로에 새 render_id로 저장되고, raw 경로는 절대 건드리지 않는다", async () => {
    const { saveFinalRenderAction } = await import("../../lib/projects/editor");

    const result = await saveFinalRenderAction("panel-1", makePngFile([1, 2, 3]));
    expect(result.ok).toBe(true);
    expect(result.storagePath).toMatch(/^user-a\/proj-1\/final\/1\/[0-9a-f-]+\.png$/);

    const uploads = currentSupabase._calls["storage.toon-panels.upload"] as string[];
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatch(/\/final\//);
    expect(uploads[0]).not.toMatch(/\/raw\//);

    // raw 경로에 대한 remove/upload가 전혀 없어야 한다 (원본 불변성).
    expect(currentSupabase._calls["storage.toon-panels.remove"]).toBeUndefined();
  });

  test("재렌더링마다 서로 다른 render_id 경로가 생성된다", async () => {
    const { saveFinalRenderAction } = await import("../../lib/projects/editor");

    const first = await saveFinalRenderAction("panel-1", makePngFile([1]));
    const second = await saveFinalRenderAction("panel-1", makePngFile([2]));
    expect(first.storagePath).not.toEqual(second.storagePath);
  });

  test("toon_panels.image_url이 새 경로로 갱신된다", async () => {
    const { saveFinalRenderAction } = await import("../../lib/projects/editor");

    const result = await saveFinalRenderAction("panel-1", makePngFile([1, 2, 3]));
    const updates = currentSupabase._calls["toon_panels.update"] as Record<string, unknown>[];
    expect(updates[0]).toEqual({ image_url: result.storagePath });
  });
});
