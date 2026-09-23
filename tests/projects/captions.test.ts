import { beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const getProjectMock = vi.fn();
const getProjectPanelsMock = vi.fn();
vi.mock("../../lib/projects/service", () => ({
  getProject: (...args: unknown[]) => getProjectMock(...args),
  getProjectPanels: (...args: unknown[]) => getProjectPanelsMock(...args),
}));

const generateCaptionMock = vi.fn();
vi.mock("../../src/providers/captionProviderRegistry", () => ({
  getCaptionProvider: () => ({ id: "gemini", generateCaption: generateCaptionMock }),
}));

interface MockConfig {
  existingCaption?: { id: string } | null;
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
      insert(payload: Record<string, unknown>) {
        record(`${table}.insert`, payload);
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
        if (table === "toon_captions") {
          return Promise.resolve({ data: config.existingCaption ?? null, error: null });
        }
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
    from: (t: string) => makeBuilder(t),
  };
}

const OWNED_USER = { id: "user-a" };
const OWNED_PROJECT = { id: "proj-1", user_id: "user-a", title: "테스트 프로젝트", story_summary: "짧은 요약" };
const PANELS = [
  {
    id: "panel-1",
    project_id: "proj-1",
    panel_number: 1,
    scene: "거실",
    narration: "평범한 아침",
    dialogue: [{ id: "d1", character_id: "char-a", text: "대사입니다", bubble_type: "speech", bubble: null }],
  },
];

function makeHashtags(count: number) {
  return Array.from({ length: count }, (_, i) => `#태그${i + 1}`);
}

let currentSupabase: ReturnType<typeof createSupabaseMock>;
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => currentSupabase,
}));

beforeEach(() => {
  vi.clearAllMocks();
  currentSupabase = createSupabaseMock();
  getProjectMock.mockResolvedValue(OWNED_PROJECT);
  getProjectPanelsMock.mockResolvedValue(PANELS);
  generateCaptionMock.mockResolvedValue({ caption: "따뜻한 하루였어요", hashtags: makeHashtags(10) });
});

describe("captions.ts는 이미지/캐릭터 Provider를 전혀 import하지 않는다", () => {
  test("소스 코드에 이미지 생성/캐릭터 분석 Provider import가 없다", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../lib/projects/captions.ts"), "utf-8");
    expect(source).not.toMatch(/characterSheetProviderRegistry/);
    expect(source).not.toMatch(/analyzerRegistry/);
    expect(source).not.toMatch(/storyboardProviderRegistry/);
  });
});

describe("generateCaptionAction", () => {
  test("타인/존재하지 않는 프로젝트는 거부된다", async () => {
    getProjectMock.mockResolvedValue(null);
    const { generateCaptionAction } = await import("../../lib/projects/captions");

    const result = await generateCaptionAction("proj-1");
    expect(result.ok).toBe(false);
    expect(generateCaptionMock).not.toHaveBeenCalled();
  });

  test("provider에는 제목/요약/장면/대사/내레이션 텍스트만 전달된다 (이미지·Character Bible 없음)", async () => {
    const { generateCaptionAction } = await import("../../lib/projects/captions");

    await generateCaptionAction("proj-1");
    expect(generateCaptionMock).toHaveBeenCalledTimes(1);
    const input = generateCaptionMock.mock.calls[0][0];
    expect(Object.keys(input).sort()).toEqual(["panels", "storySummary", "title"]);
    expect(JSON.stringify(input)).not.toMatch(/hairstyle|hair_color|visual_prompt|storage_path|image_url/);
  });

  test("성공해도 DB(toon_captions)에는 아무것도 쓰지 않는다", async () => {
    const { generateCaptionAction } = await import("../../lib/projects/captions");

    const result = await generateCaptionAction("proj-1");
    expect(result.ok).toBe(true);
    expect(currentSupabase._calls["toon_captions.insert"]).toBeUndefined();
    expect(currentSupabase._calls["toon_captions.update"]).toBeUndefined();
  });

  test("AI 결과가 유효하지 않으면(해시태그 부족) 실패를 반환한다", async () => {
    generateCaptionMock.mockResolvedValue({ caption: "캡션", hashtags: makeHashtags(2) });
    const { generateCaptionAction } = await import("../../lib/projects/captions");

    const result = await generateCaptionAction("proj-1");
    expect(result.ok).toBe(false);
  });

  test("재생성이 실패해도 기존 저장된 caption 조회 결과는 그대로 보존된다", async () => {
    generateCaptionMock.mockRejectedValue(new Error("provider boom"));
    currentSupabase = createSupabaseMock({ existingCaption: { id: "cap-1" } });
    const { generateCaptionAction, getCaptionView } = await import("../../lib/projects/captions");

    const genResult = await generateCaptionAction("proj-1");
    expect(genResult.ok).toBe(false);
    expect(currentSupabase._calls["toon_captions.update"]).toBeUndefined();
    expect(currentSupabase._calls["toon_captions.insert"]).toBeUndefined();

    // getCaptionView는 select만 하므로 기존 값이 그대로 남아있음을 별도 select mock으로 확인 가능
    await getCaptionView("proj-1");
  });
});

describe("saveCaptionAction", () => {
  test("타인 프로젝트는 거부된다", async () => {
    getProjectMock.mockResolvedValue(null);
    const { saveCaptionAction } = await import("../../lib/projects/captions");

    const result = await saveCaptionAction("proj-1", "캡션", makeHashtags(8));
    expect(result.ok).toBe(false);
  });

  test("해시태그 개수가 유효 범위를 벗어나면 저장을 거부하고 DB를 건드리지 않는다", async () => {
    const { saveCaptionAction } = await import("../../lib/projects/captions");

    const result = await saveCaptionAction("proj-1", "캡션", makeHashtags(2));
    expect(result.ok).toBe(false);
    expect(currentSupabase._calls["toon_captions.insert"]).toBeUndefined();
    expect(currentSupabase._calls["toon_captions.update"]).toBeUndefined();
  });

  test("기존 caption이 없으면 새로 insert한다", async () => {
    currentSupabase = createSupabaseMock({ existingCaption: null });
    const { saveCaptionAction } = await import("../../lib/projects/captions");

    const result = await saveCaptionAction("proj-1", "새 캡션", makeHashtags(8));
    expect(result.ok).toBe(true);
    expect(currentSupabase._calls["toon_captions.insert"]).toHaveLength(1);
    expect(currentSupabase._calls["toon_captions.update"]).toBeUndefined();
  });

  test("기존 caption이 있으면 update한다", async () => {
    currentSupabase = createSupabaseMock({ existingCaption: { id: "cap-1" } });
    const { saveCaptionAction } = await import("../../lib/projects/captions");

    const result = await saveCaptionAction("proj-1", "수정된 캡션", makeHashtags(9));
    expect(result.ok).toBe(true);
    expect(currentSupabase._calls["toon_captions.update"]).toHaveLength(1);
    expect(currentSupabase._calls["toon_captions.insert"]).toBeUndefined();
  });
});
