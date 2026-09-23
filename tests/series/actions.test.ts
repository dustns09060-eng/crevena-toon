import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const getCharacterMock = vi.fn();
vi.mock("../../lib/characters/service", () => ({
  getCharacter: (...args: unknown[]) => getCharacterMock(...args),
}));

const getLocationMock = vi.fn();
vi.mock("../../lib/locations/service", () => ({
  getLocation: (...args: unknown[]) => getLocationMock(...args),
}));

interface MockConfig {
  series?: { id: string; user_id: string } | null;
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
      upsert(payload: Record<string, unknown>, options?: unknown) {
        record(`${table}.upsert`, { payload, options });
        return builder;
      },
      delete() {
        record(`${table}.delete`);
        return builder;
      },
      eq(col: string, val: unknown) {
        record(`${table}.eq`, { col, val });
        return builder;
      },
      order() {
        return builder;
      },
      maybeSingle() {
        if (table === "toon_series") return Promise.resolve({ data: config.series ?? null, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      single() {
        if (table === "toon_series") return Promise.resolve({ data: { id: "series-1", user_id: "user-a", title: "유별맘" }, error: null });
        return Promise.resolve({ data: null, error: null });
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

const OWNED_USER = { id: "user-a" };

let currentSupabase: ReturnType<typeof createSupabaseMock>;
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => currentSupabase,
}));

beforeEach(() => {
  vi.clearAllMocks();
  currentSupabase = createSupabaseMock({ series: { id: "series-1", user_id: "user-a" } });
  getCharacterMock.mockResolvedValue({ id: "char-a", display_name: "엄마" });
  getLocationMock.mockResolvedValue({ id: "loc-a", display_name: "우리 집 거실" });
});

describe("createSeriesAction", () => {
  test("빈 제목은 거부된다", async () => {
    const { createSeriesAction } = await import("../../lib/series/actions");
    const result = await createSeriesAction("   ");
    expect(result.ok).toBe(false);
  });

  test("정상 제목이면 시리즈를 만든다", async () => {
    const { createSeriesAction } = await import("../../lib/series/actions");
    const result = await createSeriesAction("유별맘");
    expect(result.ok).toBe(true);
    expect(currentSupabase._calls["toon_series.insert"]).toHaveLength(1);
  });
});

describe("linkCharacterToSeriesAction — 기존 캐릭터 재사용", () => {
  test("타인 시리즈에는 연결할 수 없다", async () => {
    currentSupabase = createSupabaseMock({ series: null });
    const { linkCharacterToSeriesAction } = await import("../../lib/series/actions");

    const result = await linkCharacterToSeriesAction("series-1", "char-a");
    expect(result.ok).toBe(false);
  });

  test("타인 캐릭터는 연결할 수 없다 (getCharacter가 null 반환)", async () => {
    getCharacterMock.mockResolvedValue(null);
    const { linkCharacterToSeriesAction } = await import("../../lib/series/actions");

    const result = await linkCharacterToSeriesAction("series-1", "char-a");
    expect(result.ok).toBe(false);
  });

  test("기존 캐릭터를 시리즈에 연결하면 toon_series_characters에만 upsert(ignoreDuplicates)하고, 캐릭터/시트를 새로 만들지 않는다", async () => {
    const { linkCharacterToSeriesAction } = await import("../../lib/series/actions");

    const result = await linkCharacterToSeriesAction("series-1", "char-a");
    expect(result.ok).toBe(true);
    expect(currentSupabase._calls["toon_series_characters.upsert"]).toEqual([
      {
        payload: { series_id: "series-1", character_id: "char-a" },
        options: { onConflict: "series_id,character_id", ignoreDuplicates: true },
      },
    ]);
    // 캐릭터 테이블/시트 테이블에는 어떤 insert도 없어야 한다(재생성 없음).
    expect(currentSupabase._calls["toon_characters.insert"]).toBeUndefined();
    expect(currentSupabase._calls["toon_character_sheets.insert"]).toBeUndefined();
  });

  test("이미 연결된 캐릭터를 다시 연결해도(재시도) 실패하지 않는다 — upsert ignoreDuplicates로 멱등 처리", async () => {
    const { linkCharacterToSeriesAction } = await import("../../lib/series/actions");

    const first = await linkCharacterToSeriesAction("series-1", "char-a");
    const second = await linkCharacterToSeriesAction("series-1", "char-a");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(currentSupabase._calls["toon_series_characters.upsert"]).toHaveLength(2);
  });
});

describe("unlinkCharacterFromSeriesAction", () => {
  test("타인 시리즈에서는 연결을 해제할 수 없다", async () => {
    currentSupabase = createSupabaseMock({ series: null });
    const { unlinkCharacterFromSeriesAction } = await import("../../lib/series/actions");

    const result = await unlinkCharacterFromSeriesAction("series-1", "char-a");
    expect(result.ok).toBe(false);
  });

  test("정상 요청이면 조인 행만 삭제한다", async () => {
    const { unlinkCharacterFromSeriesAction } = await import("../../lib/series/actions");

    const result = await unlinkCharacterFromSeriesAction("series-1", "char-a");
    expect(result.ok).toBe(true);
    expect(currentSupabase._calls["toon_series_characters.delete"]).toHaveLength(1);
  });
});

describe("listSeriesCharactersAction", () => {
  test("타인 시리즈는 빈 배열을 반환한다", async () => {
    currentSupabase = createSupabaseMock({ series: null });
    const { listSeriesCharactersAction } = await import("../../lib/series/actions");

    const result = await listSeriesCharactersAction("series-1");
    expect(result).toEqual([]);
  });
});

describe("linkLocationToSeriesAction — 기존 장소 재사용", () => {
  test("타인 시리즈에는 연결할 수 없다", async () => {
    currentSupabase = createSupabaseMock({ series: null });
    const { linkLocationToSeriesAction } = await import("../../lib/series/actions");

    const result = await linkLocationToSeriesAction("series-1", "loc-a");
    expect(result.ok).toBe(false);
  });

  test("타인 장소는 연결할 수 없다 (getLocation이 null 반환)", async () => {
    getLocationMock.mockResolvedValue(null);
    const { linkLocationToSeriesAction } = await import("../../lib/series/actions");

    const result = await linkLocationToSeriesAction("series-1", "loc-a");
    expect(result.ok).toBe(false);
  });

  test("기존 장소를 시리즈에 연결하면 toon_series_locations에만 upsert(ignoreDuplicates)하고, 장소를 새로 만들지 않는다", async () => {
    const { linkLocationToSeriesAction } = await import("../../lib/series/actions");

    const result = await linkLocationToSeriesAction("series-1", "loc-a");
    expect(result.ok).toBe(true);
    expect(currentSupabase._calls["toon_series_locations.upsert"]).toEqual([
      {
        payload: { series_id: "series-1", location_id: "loc-a" },
        options: { onConflict: "series_id,location_id", ignoreDuplicates: true },
      },
    ]);
    expect(currentSupabase._calls["toon_locations.insert"]).toBeUndefined();
  });

  test("이미 연결된 장소를 다시 연결해도(재시도) 실패하지 않는다 — upsert ignoreDuplicates로 멱등 처리", async () => {
    const { linkLocationToSeriesAction } = await import("../../lib/series/actions");

    const first = await linkLocationToSeriesAction("series-1", "loc-a");
    const second = await linkLocationToSeriesAction("series-1", "loc-a");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(currentSupabase._calls["toon_series_locations.upsert"]).toHaveLength(2);
  });
});

describe("unlinkLocationFromSeriesAction", () => {
  test("타인 시리즈에서는 연결을 해제할 수 없다", async () => {
    currentSupabase = createSupabaseMock({ series: null });
    const { unlinkLocationFromSeriesAction } = await import("../../lib/series/actions");

    const result = await unlinkLocationFromSeriesAction("series-1", "loc-a");
    expect(result.ok).toBe(false);
  });

  test("정상 요청이면 조인 행만 삭제한다 (장소 자체는 삭제되지 않음)", async () => {
    const { unlinkLocationFromSeriesAction } = await import("../../lib/series/actions");

    const result = await unlinkLocationFromSeriesAction("series-1", "loc-a");
    expect(result.ok).toBe(true);
    expect(currentSupabase._calls["toon_series_locations.delete"]).toHaveLength(1);
    expect(currentSupabase._calls["toon_locations.delete"]).toBeUndefined();
  });
});

describe("listSeriesLocationsAction", () => {
  test("타인 시리즈는 빈 배열을 반환한다", async () => {
    currentSupabase = createSupabaseMock({ series: null });
    const { listSeriesLocationsAction } = await import("../../lib/series/actions");

    const result = await listSeriesLocationsAction("series-1");
    expect(result).toEqual([]);
  });
});
