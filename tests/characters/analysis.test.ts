import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const getCharacterMock = vi.fn();
const listReferencesMock = vi.fn();
vi.mock("../../lib/characters/service", () => ({
  getCharacter: (...args: unknown[]) => getCharacterMock(...args),
  listReferences: (...args: unknown[]) => listReferencesMock(...args),
}));

const analyzeCharacterMock = vi.fn();
vi.mock("../../src/providers/analyzerRegistry", () => ({
  getCharacterAnalyzer: () => ({ id: "gemini", analyzeCharacter: analyzeCharacterMock }),
}));

const updateEqMock = vi.fn();
const updateMock = vi.fn((_payload: Record<string, unknown>) => ({ eq: updateEqMock }));
const downloadMock = vi.fn();
const getUserMock = vi.fn();

const supabaseStub = {
  auth: { getUser: getUserMock },
  from: vi.fn(() => ({ update: updateMock })),
  storage: { from: vi.fn(() => ({ download: downloadMock })) },
};

vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => supabaseStub,
}));

const VALID_ANALYSIS = {
  hairstyle: "짧은 단발머리",
  hair_color: "검은색",
  face_features: "둥근 얼굴형",
  body_type: "보통 체형",
  representative_outfit: "검은 티셔츠",
  distinctive_features: null,
  visual_prompt: "짧은 단발머리의 30대 여성 캐릭터",
  negative_constraints: ["머리색을 바꾸지 않는다"],
};

const OWNED_USER = { id: "user-a" };
const OWNED_CHARACTER = {
  id: "char-1",
  user_id: "user-a",
  display_name: "엄마",
  role: "주인공",
  age_group: null,
  personality: null,
  representative_outfit: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: OWNED_USER } });
  updateEqMock.mockResolvedValue({ error: null });
});

describe("analyzeCharacterAction", () => {
  test("타인 소유(또는 존재하지 않는) character는 분석이 거부된다", async () => {
    getCharacterMock.mockResolvedValue(null); // service.getCharacter는 RLS로 스코프되므로 남의 캐릭터면 null
    const { analyzeCharacterAction } = await import("../../lib/characters/analysis");

    const result = await analyzeCharacterAction("someone-elses-char");
    expect(result.ok).toBe(false);
    expect(analyzeCharacterMock).not.toHaveBeenCalled();
  });

  test("참조 사진이 없는 character는 분석이 거부된다", async () => {
    getCharacterMock.mockResolvedValue(OWNED_CHARACTER);
    listReferencesMock.mockResolvedValue([]);
    const { analyzeCharacterAction } = await import("../../lib/characters/analysis");

    const result = await analyzeCharacterAction("char-1");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/참조 사진/);
    expect(analyzeCharacterMock).not.toHaveBeenCalled();
  });

  test("정상 분석 결과는 DB를 건드리지 않고 그대로 반환한다 (저장은 별도 승인 필요)", async () => {
    getCharacterMock.mockResolvedValue(OWNED_CHARACTER);
    listReferencesMock.mockResolvedValue([{ storage_path: "user-a/char-1/a.jpg" }]);
    downloadMock.mockResolvedValue({
      data: { type: "image/jpeg", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer },
      error: null,
    });
    analyzeCharacterMock.mockResolvedValue(VALID_ANALYSIS);
    const { analyzeCharacterAction } = await import("../../lib/characters/analysis");

    const result = await analyzeCharacterAction("char-1");
    expect(result.ok).toBe(true);
    expect(result.result?.hairstyle).toBe("짧은 단발머리");
    expect(updateMock).not.toHaveBeenCalled(); // 분석만으로는 저장(승인)되지 않는다
  });

  test("AI가 malformed 결과를 반환하면 거부되고 DB는 건드리지 않는다 (재분석 실패 시 기존 데이터 유지)", async () => {
    getCharacterMock.mockResolvedValue(OWNED_CHARACTER);
    listReferencesMock.mockResolvedValue([{ storage_path: "user-a/char-1/a.jpg" }]);
    downloadMock.mockResolvedValue({
      data: { type: "image/jpeg", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer },
      error: null,
    });
    analyzeCharacterMock.mockResolvedValue({ hairstyle: "빠진 필드 투성이" }); // 필수 필드 누락
    const { analyzeCharacterAction } = await import("../../lib/characters/analysis");

    const result = await analyzeCharacterAction("char-1");
    expect(result.ok).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("동시에 같은 캐릭터를 두 번 분석 요청하면 두 번째는 즉시 거부된다 (중복 요청 방지)", async () => {
    getCharacterMock.mockResolvedValue(OWNED_CHARACTER);
    listReferencesMock.mockResolvedValue([{ storage_path: "user-a/char-1/a.jpg" }]);
    downloadMock.mockResolvedValue({
      data: { type: "image/jpeg", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer },
      error: null,
    });
    let resolveAnalysis: (v: typeof VALID_ANALYSIS) => void;
    analyzeCharacterMock.mockReturnValue(
      new Promise((resolve) => {
        resolveAnalysis = resolve;
      })
    );
    const { analyzeCharacterAction } = await import("../../lib/characters/analysis");

    const first = analyzeCharacterAction("char-1");
    await new Promise((r) => setTimeout(r, 0)); // 첫 요청이 in-flight 상태가 되도록 한 틱 양보
    const second = await analyzeCharacterAction("char-1");

    expect(second.ok).toBe(false);
    expect(second.message).toMatch(/이미/);

    resolveAnalysis!(VALID_ANALYSIS);
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
  });
});

describe("saveCharacterBibleAction", () => {
  test("타인 character에는 저장할 수 없다", async () => {
    getCharacterMock.mockResolvedValue(null);
    const { saveCharacterBibleAction } = await import("../../lib/characters/analysis");

    const result = await saveCharacterBibleAction("someone-elses-char", VALID_ANALYSIS);
    expect(result.ok).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("유효한 데이터는 정상 저장된다 (분석 승인 흐름)", async () => {
    getCharacterMock.mockResolvedValue(OWNED_CHARACTER);
    const { saveCharacterBibleAction } = await import("../../lib/characters/analysis");

    const result = await saveCharacterBibleAction("char-1", VALID_ANALYSIS);
    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(1);
    const payload = updateMock.mock.calls[0][0];
    expect(payload.hairstyle).toBe("짧은 단발머리");
    expect(payload.negative_constraints).toEqual(["머리색을 바꾸지 않는다"]);
  });

  test("필수 필드가 빠진 데이터는 저장이 거부된다", async () => {
    getCharacterMock.mockResolvedValue(OWNED_CHARACTER);
    const { saveCharacterBibleAction } = await import("../../lib/characters/analysis");

    const { hairstyle: _omit, ...invalid } = VALID_ANALYSIS;
    const result = await saveCharacterBibleAction("char-1", invalid);
    expect(result.ok).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
