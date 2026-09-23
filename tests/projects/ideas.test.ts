import { beforeEach, describe, expect, test, vi } from "vitest";

const generateIdeasMock = vi.fn();
vi.mock("../../src/providers/storyboardProviderRegistry", () => ({
  getStoryboardProvider: () => ({ id: "gemini", generateIdeas: generateIdeasMock, generateStoryboard: vi.fn() }),
}));

const inMock = vi.fn();
function createSupabaseMock(charactersFound: unknown[]) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-a" } } }) },
    from: () => ({
      select: () => ({
        in: (...args: unknown[]) => {
          inMock(...args);
          return Promise.resolve({ data: charactersFound, error: null });
        },
      }),
    }),
  };
}

let currentSupabase: ReturnType<typeof createSupabaseMock>;
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => currentSupabase,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateIdeasAction", () => {
  test("캐릭터를 하나도 선택하지 않으면 거부된다", async () => {
    currentSupabase = createSupabaseMock([]);
    const { generateIdeasAction } = await import("../../lib/projects/ideas");

    const result = await generateIdeasAction([]);
    expect(result.ok).toBe(false);
    expect(generateIdeasMock).not.toHaveBeenCalled();
  });

  test("본인 소유가 아닌 캐릭터가 섞여 있으면(요청 개수와 실제 조회 개수 불일치) 거부된다", async () => {
    currentSupabase = createSupabaseMock([{ id: "char-a", display_name: "엄마", role: "주인공", personality: null, speaking_style: null }]);
    const { generateIdeasAction } = await import("../../lib/projects/ideas");

    const result = await generateIdeasAction(["char-a", "not-owned-char"]);
    expect(result.ok).toBe(false);
    expect(generateIdeasMock).not.toHaveBeenCalled();
  });

  test("본인 소유 캐릭터만 있으면 3~5개 소재를 반환한다", async () => {
    currentSupabase = createSupabaseMock([
      { id: "char-a", display_name: "엄마", role: "주인공", personality: null, speaking_style: null },
    ]);
    generateIdeasMock.mockResolvedValue([
      { title: "a", description: "d1" },
      { title: "b", description: "d2" },
      { title: "c", description: "d3" },
    ]);
    const { generateIdeasAction } = await import("../../lib/projects/ideas");

    const result = await generateIdeasAction(["char-a"]);
    expect(result.ok).toBe(true);
    expect(result.ideas).toHaveLength(3);
  });
});
