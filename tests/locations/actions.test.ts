import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

class RedirectSignal extends Error {
  constructor(public url: string) {
    super(`REDIRECT:${url}`);
  }
}
const redirectMock = vi.fn((url: string) => {
  throw new RedirectSignal(url);
});
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const OWNED_USER = { id: "user-a" };

function createSupabaseMock() {
  const calls: Record<string, unknown[]> = {};
  function record(key: string, arg?: unknown) {
    (calls[key] ??= []).push(arg);
  }

  function makeBuilder(table: string) {
    const builder: Record<string, unknown> = {
      insert(payload: Record<string, unknown>) {
        record(`${table}.insert`, payload);
        return builder;
      },
      update(payload: Record<string, unknown>) {
        record(`${table}.update`, payload);
        return builder;
      },
      delete() {
        record(`${table}.delete`);
        return builder;
      },
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        record(`${table}.eq`, { col, val });
        return builder;
      },
      single() {
        return Promise.resolve({ data: { id: "loc-1", display_name: "우리 집 거실" }, error: null });
      },
      then(resolve: (v: { data: unknown[]; error: null }) => void) {
        resolve({ data: [], error: null });
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

let currentSupabase: ReturnType<typeof createSupabaseMock>;
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => currentSupabase,
}));

beforeEach(() => {
  vi.clearAllMocks();
  currentSupabase = createSupabaseMock();
});

function buildFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("display_name", overrides.display_name ?? "우리 집 거실");
  fd.set(
    "visual_prompt",
    overrides.visual_prompt ?? "회색 소파가 있고 밝은 원목 바닥, 아이보리 러그와 낮은 책장이 있는 거실"
  );
  fd.set("wall_and_floor", overrides.wall_and_floor ?? "");
  fd.set("fixed_furniture", overrides.fixed_furniture ?? "");
  fd.set("window_style", overrides.window_style ?? "");
  fd.set("recurring_props", overrides.recurring_props ?? "");
  fd.set("distinctive_features", overrides.distinctive_features ?? "");
  return fd;
}

describe("createLocationAction", () => {
  test("이름 + 설명만 입력해도 생성되고 목록으로 리다이렉트된다(고급 설정은 전부 선택)", async () => {
    const { createLocationAction } = await import("../../lib/locations/actions");
    await expect(createLocationAction({ ok: false }, buildFormData())).rejects.toThrow(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith("/toon/locations");
    expect(currentSupabase._calls["toon_locations.insert"]).toEqual([
      {
        display_name: "우리 집 거실",
        visual_prompt: "회색 소파가 있고 밝은 원목 바닥, 아이보리 러그와 낮은 책장이 있는 거실",
        wall_and_floor: null,
        fixed_furniture: null,
        window_style: null,
        recurring_props: null,
        distinctive_features: null,
      },
    ]);
  });

  test("장소 이름이 없으면 거부된다(리다이렉트 없음)", async () => {
    const { createLocationAction } = await import("../../lib/locations/actions");
    const result = await createLocationAction({ ok: false }, buildFormData({ display_name: "" }));
    expect(result.ok).toBe(false);
    expect(currentSupabase._calls["toon_locations.insert"]).toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  test("설명이 없으면 거부된다", async () => {
    const { createLocationAction } = await import("../../lib/locations/actions");
    const result = await createLocationAction({ ok: false }, buildFormData({ visual_prompt: "" }));
    expect(result.ok).toBe(false);
  });

  test("고급 설정을 채우면 함께 저장된다", async () => {
    const { createLocationAction } = await import("../../lib/locations/actions");
    await expect(
      createLocationAction({ ok: false }, buildFormData({ wall_and_floor: "크림색 벽, 밝은 원목 바닥" }))
    ).rejects.toThrow(RedirectSignal);
    expect((currentSupabase._calls["toon_locations.insert"]![0] as Record<string, unknown>).wall_and_floor).toBe(
      "크림색 벽, 밝은 원목 바닥"
    );
  });
});

describe("updateLocationAction", () => {
  test("정상 입력이면 갱신된다", async () => {
    const { updateLocationAction } = await import("../../lib/locations/actions");
    const result = await updateLocationAction("loc-1", { ok: false }, buildFormData({ display_name: "우리 집 안방" }));
    expect(result.ok).toBe(true);
    expect(currentSupabase._calls["toon_locations.update"]).toHaveLength(1);
  });
});

describe("deleteLocationAction", () => {
  test("정상 삭제되면 ok:true", async () => {
    const { deleteLocationAction } = await import("../../lib/locations/actions");
    const result = await deleteLocationAction("loc-1");
    expect(result.ok).toBe(true);
    expect(currentSupabase._calls["toon_locations.delete"]).toHaveLength(1);
  });
});
