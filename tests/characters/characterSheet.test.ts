import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const getCharacterMock = vi.fn();
const listReferencesMock = vi.fn();
vi.mock("../../lib/characters/service", () => ({
  getCharacter: (...args: unknown[]) => getCharacterMock(...args),
  listReferences: (...args: unknown[]) => listReferencesMock(...args),
}));

const generateMock = vi.fn();
vi.mock("../../src/providers/characterSheetProviderRegistry", () => ({
  getCharacterSheetProvider: () => ({ id: "gemini", generate: generateMock }),
}));

interface MockConfig {
  downloadOk?: boolean;
  existingSheetCount?: number;
  maybeSingleResult?: { id: string; storage_path: string; character_id: string } | null;
}

function createSupabaseMock(config: MockConfig = {}) {
  const calls: Record<string, unknown[]> = {};
  function record(key: string, arg?: unknown) {
    (calls[key] ??= []).push(arg);
  }

  function makeTableBuilder(table: string) {
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
      single() {
        if (table === "toon_generations" && insertPayload) {
          return Promise.resolve({ data: { id: "gen-1" }, error: null });
        }
        if (table === "toon_character_sheets" && insertPayload) {
          return Promise.resolve({
            data: {
              id: "sheet-1",
              status: "candidate",
              storage_path: insertPayload.storage_path,
              generation_version: insertPayload.generation_version,
              created_at: "2025-01-01T00:00:00Z",
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle() {
        return Promise.resolve({ data: config.maybeSingleResult ?? null, error: null });
      },
      then(resolve: (v: { count?: number; error: null }) => void) {
        if (table === "toon_character_sheets" && selectOpts?.count === "exact") {
          resolve({ count: config.existingSheetCount ?? 0, error: null });
          return;
        }
        resolve({ error: null });
      },
    };
    return builder;
  }

  const supabase = {
    _calls: calls,
    storage: {
      from(bucket: string) {
        return {
          download: async (path: string) => {
            record(`storage.${bucket}.download`, path);
            if (config.downloadOk === false) return { data: null, error: new Error("boom") };
            return {
              data: { type: "image/jpeg", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer },
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
    auth: { getUser: async () => ({ data: { user: OWNED_USER } }) },
    from: (table: string) => makeTableBuilder(table),
  };
  return supabase;
}

const OWNED_USER = { id: "user-a" };
const OWNED_CHARACTER_WITH_BIBLE = {
  id: "char-1",
  user_id: "user-a",
  display_name: "엄마",
  hairstyle: "짧은 단발머리",
  hair_color: "검은색",
  face_features: "둥근 얼굴형",
  body_type: "보통 체형",
  representative_outfit: "검은 티셔츠",
  distinctive_features: null,
  visual_prompt: "짧은 단발머리 여성 캐릭터",
  negative_constraints: ["머리색을 바꾸지 않는다"],
};
const OWNED_CHARACTER_NO_BIBLE = { ...OWNED_CHARACTER_WITH_BIBLE, hairstyle: null };

let currentSupabase: ReturnType<typeof createSupabaseMock>;
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => currentSupabase,
}));
vi.mock("../../lib/supabase/admin", () => ({
  createAdminClient: () => currentSupabase,
}));

beforeEach(() => {
  vi.clearAllMocks();
  currentSupabase = createSupabaseMock();
});

describe("generateCharacterSheetAction", () => {
  test("타인 소유(또는 존재하지 않는) character는 거부된다", async () => {
    getCharacterMock.mockResolvedValue(null);
    const { generateCharacterSheetAction } = await import("../../lib/characters/characterSheet");

    const result = await generateCharacterSheetAction("someone-elses-char");
    expect(result.ok).toBe(false);
    expect(generateMock).not.toHaveBeenCalled();
  });

  test("Character Bible이 저장되지 않은 캐릭터는 거부된다", async () => {
    getCharacterMock.mockResolvedValue(OWNED_CHARACTER_NO_BIBLE);
    const { generateCharacterSheetAction } = await import("../../lib/characters/characterSheet");

    const result = await generateCharacterSheetAction("char-1");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Character Bible/);
    expect(generateMock).not.toHaveBeenCalled();
  });

  test("참조 사진이 없으면 거부된다", async () => {
    getCharacterMock.mockResolvedValue(OWNED_CHARACTER_WITH_BIBLE);
    listReferencesMock.mockResolvedValue([]);
    const { generateCharacterSheetAction } = await import("../../lib/characters/characterSheet");

    const result = await generateCharacterSheetAction("char-1");
    expect(result.ok).toBe(false);
    expect(generateMock).not.toHaveBeenCalled();
  });

  test("성공 시 candidate가 생성되고, 캐릭터의 approved 이미지(character_sheet_url)는 건드리지 않는다", async () => {
    getCharacterMock.mockResolvedValue(OWNED_CHARACTER_WITH_BIBLE);
    listReferencesMock.mockResolvedValue([
      { storage_path: "user-a/char-1/a.jpg", is_primary: true, sort_order: 0 },
    ]);
    generateMock.mockResolvedValue({ imageBytes: Buffer.from([1, 2, 3]), provider: "gemini", model: "gemini-2.5-flash-image" });
    const { generateCharacterSheetAction } = await import("../../lib/characters/characterSheet");

    const result = await generateCharacterSheetAction("char-1");
    expect(result.ok).toBe(true);
    expect(result.sheet?.status).toBe("candidate");
    expect(currentSupabase._calls["toon_characters.update"]).toBeUndefined();
  });

  test("이미지 생성 실패 시 toon_character_sheets에 아무것도 저장하지 않는다 (기존 approved 유지)", async () => {
    getCharacterMock.mockResolvedValue(OWNED_CHARACTER_WITH_BIBLE);
    listReferencesMock.mockResolvedValue([
      { storage_path: "user-a/char-1/a.jpg", is_primary: true, sort_order: 0 },
    ]);
    generateMock.mockRejectedValue(new Error("provider boom"));
    const { generateCharacterSheetAction } = await import("../../lib/characters/characterSheet");

    const result = await generateCharacterSheetAction("char-1");
    expect(result.ok).toBe(false);
    expect(currentSupabase._calls["toon_character_sheets.insert"]).toBeUndefined();
    expect(currentSupabase._calls["toon_characters.update"]).toBeUndefined();
  });

  test("동시에 같은 캐릭터를 두 번 요청하면 두 번째는 즉시 거부된다 (중복 요청 방지)", async () => {
    getCharacterMock.mockResolvedValue(OWNED_CHARACTER_WITH_BIBLE);
    listReferencesMock.mockResolvedValue([
      { storage_path: "user-a/char-1/a.jpg", is_primary: true, sort_order: 0 },
    ]);
    let resolveGen: (v: { imageBytes: Buffer; provider: string; model: string }) => void;
    generateMock.mockReturnValue(
      new Promise((resolve) => {
        resolveGen = resolve;
      })
    );
    const { generateCharacterSheetAction } = await import("../../lib/characters/characterSheet");

    const first = generateCharacterSheetAction("char-1");
    await new Promise((r) => setTimeout(r, 0));
    const second = await generateCharacterSheetAction("char-1");

    expect(second.ok).toBe(false);
    expect(second.message).toMatch(/이미/);

    resolveGen!({ imageBytes: Buffer.from([1]), provider: "gemini", model: "m" });
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
  });
});

describe("approveCharacterSheetAction", () => {
  test("타인 캐릭터에는 승인할 수 없다", async () => {
    getCharacterMock.mockResolvedValue(null);
    const { approveCharacterSheetAction } = await import("../../lib/characters/characterSheet");

    const result = await approveCharacterSheetAction("someone-elses-char", "sheet-1");
    expect(result.ok).toBe(false);
  });

  test("존재하지 않는 sheetId는 거부된다", async () => {
    getCharacterMock.mockResolvedValue(OWNED_CHARACTER_WITH_BIBLE);
    currentSupabase = createSupabaseMock({ maybeSingleResult: null });
    const { approveCharacterSheetAction } = await import("../../lib/characters/characterSheet");

    const result = await approveCharacterSheetAction("char-1", "does-not-exist");
    expect(result.ok).toBe(false);
  });

  test("승인 시 기존 approved를 먼저 내리고 새 후보를 approved로 바꾼 뒤 캐릭터를 갱신한다", async () => {
    getCharacterMock.mockResolvedValue(OWNED_CHARACTER_WITH_BIBLE);
    currentSupabase = createSupabaseMock({
      maybeSingleResult: { id: "sheet-2", storage_path: "user-a/char-1/gen-2/sheet.png", character_id: "char-1" },
    });
    const { approveCharacterSheetAction } = await import("../../lib/characters/characterSheet");

    const result = await approveCharacterSheetAction("char-1", "sheet-2");
    expect(result.ok).toBe(true);

    const updates = currentSupabase._calls["toon_character_sheets.update"] as Record<string, unknown>[];
    expect(updates[0]).toEqual({ status: "rejected" }); // 기존 approved 먼저 해제
    expect(updates[1]).toEqual({ status: "approved" }); // 그다음 새 후보 승인

    const charUpdates = currentSupabase._calls["toon_characters.update"] as Record<string, unknown>[];
    expect(charUpdates[0]).toEqual({ character_sheet_url: "user-a/char-1/gen-2/sheet.png" });
  });
});
