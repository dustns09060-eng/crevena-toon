import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const getProjectMock = vi.fn();
const getProjectPanelsMock = vi.fn();
vi.mock("../../lib/projects/service", () => ({
  getProject: (...args: unknown[]) => getProjectMock(...args),
  getProjectPanels: (...args: unknown[]) => getProjectPanelsMock(...args),
}));

const getCaptionViewMock = vi.fn();
vi.mock("../../lib/projects/captions", () => ({
  getCaptionView: (...args: unknown[]) => getCaptionViewMock(...args),
}));

function createSupabaseMock() {
  const calls: Record<string, unknown[]> = {};
  function record(key: string, arg?: unknown) {
    (calls[key] ??= []).push(arg);
  }
  function makeBuilder(table: string) {
    const builder: Record<string, unknown> = {
      update(payload: Record<string, unknown>) {
        record(`${table}.update`, payload);
        return builder;
      },
      eq(col: string, val: unknown) {
        record(`${table}.eq`, { col, val });
        return builder;
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
      from() {
        return {
          createSignedUrl: async (p: string) => ({ data: { signedUrl: "https://signed.example/" + p }, error: null }),
        };
      },
    },
    from: (t: string) => makeBuilder(t),
  };
}

const OWNED_USER = { id: "user-a" };
const BASE_PROJECT = { id: "proj-1", user_id: "user-a", title: "제목", status: "confirmed" };

function makePanel(overrides: Record<string, unknown>) {
  return { id: "panel-1", panel_number: 1, raw_image_url: "raw", image_url: "final", ...overrides };
}

let currentSupabase: ReturnType<typeof createSupabaseMock>;
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => currentSupabase,
}));

beforeEach(() => {
  vi.clearAllMocks();
  currentSupabase = createSupabaseMock();
  getProjectMock.mockResolvedValue(BASE_PROJECT);
  getProjectPanelsMock.mockResolvedValue([makePanel({})]);
  getCaptionViewMock.mockResolvedValue(null);
});

describe("getFinalPageData", () => {
  test("타인 프로젝트는 거부된다", async () => {
    getProjectMock.mockResolvedValue(null);
    const { getFinalPageData } = await import("../../lib/projects/finalPage");

    const result = await getFinalPageData("proj-1");
    expect(result.ok).toBe(false);
  });

  test("아직 storyboard가 확정 전이면 거부된다", async () => {
    getProjectMock.mockResolvedValue({ ...BASE_PROJECT, status: "draft" });
    const { getFinalPageData } = await import("../../lib/projects/finalPage");

    const result = await getFinalPageData("proj-1");
    expect(result.ok).toBe(false);
  });

  test("정상 조회 시 readiness와 panel별 서명 URL을 함께 반환한다", async () => {
    const { getFinalPageData } = await import("../../lib/projects/finalPage");

    const result = await getFinalPageData("proj-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.readiness.ready).toBe(true);
      expect(result.panels[0].finalSignedUrl).toMatch(/^https:\/\//);
    }
  });

  test("final 이미지가 없는 컷이 있으면 readiness.ready=false와 안내 메시지를 포함한다", async () => {
    getProjectPanelsMock.mockResolvedValue([makePanel({ image_url: null })]);
    const { getFinalPageData } = await import("../../lib/projects/finalPage");

    const result = await getFinalPageData("proj-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.readiness.ready).toBe(false);
      expect(result.readiness.errors.join()).toMatch(/아직 최종 이미지가 만들어지지 않은 컷이 있어요/);
    }
  });
});

describe("completeProjectAction", () => {
  test("타인 프로젝트는 거부된다", async () => {
    getProjectMock.mockResolvedValue(null);
    const { completeProjectAction } = await import("../../lib/projects/finalPage");

    const result = await completeProjectAction("proj-1");
    expect(result.ok).toBe(false);
  });

  test("final 이미지가 없는 컷이 있으면 완료 처리가 차단된다", async () => {
    getProjectPanelsMock.mockResolvedValue([makePanel({ image_url: null })]);
    const { completeProjectAction } = await import("../../lib/projects/finalPage");

    const result = await completeProjectAction("proj-1");
    expect(result.ok).toBe(false);
    expect(currentSupabase._calls["toon_projects.update"]).toBeUndefined();
  });

  test("조건을 모두 만족하면 completed로 전환된다", async () => {
    const { completeProjectAction } = await import("../../lib/projects/finalPage");

    const result = await completeProjectAction("proj-1");
    expect(result.ok).toBe(true);
    expect(currentSupabase._calls["toon_projects.update"]).toEqual([{ status: "completed" }]);
  });

  test("이미 completed면 아무 것도 바꾸지 않고 성공을 반환한다 (멱등)", async () => {
    getProjectMock.mockResolvedValue({ ...BASE_PROJECT, status: "completed" });
    const { completeProjectAction } = await import("../../lib/projects/finalPage");

    const result = await completeProjectAction("proj-1");
    expect(result.ok).toBe(true);
    expect(currentSupabase._calls["toon_projects.update"]).toBeUndefined();
  });
});

describe("reopenProjectAction", () => {
  test("타인 프로젝트는 거부된다", async () => {
    getProjectMock.mockResolvedValue(null);
    const { reopenProjectAction } = await import("../../lib/projects/finalPage");

    const result = await reopenProjectAction("proj-1");
    expect(result.ok).toBe(false);
  });

  test("completed 프로젝트를 confirmed로 되돌린다", async () => {
    getProjectMock.mockResolvedValue({ ...BASE_PROJECT, status: "completed" });
    const { reopenProjectAction } = await import("../../lib/projects/finalPage");

    const result = await reopenProjectAction("proj-1");
    expect(result.ok).toBe(true);
    expect(currentSupabase._calls["toon_projects.update"]).toEqual([{ status: "confirmed" }]);
  });

  test("completed가 아니면 아무 것도 바꾸지 않는다", async () => {
    const { reopenProjectAction } = await import("../../lib/projects/finalPage");

    const result = await reopenProjectAction("proj-1");
    expect(result.ok).toBe(true);
    expect(currentSupabase._calls["toon_projects.update"]).toBeUndefined();
  });
});
