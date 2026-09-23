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

const createCharacterMock = vi.fn();
vi.mock("../../lib/characters/service", () => ({
  createCharacter: (...args: unknown[]) => createCharacterMock(...args),
}));

const uploadReferenceImageMock = vi.fn();
vi.mock("../../lib/characters/references", () => ({
  uploadReferenceImage: (...args: unknown[]) => uploadReferenceImageMock(...args),
  deleteReference: vi.fn(),
  setPrimaryReference: vi.fn(),
}));

const OWNED_USER = { id: "user-a" };
const currentSupabase = { auth: { getUser: async () => ({ data: { user: OWNED_USER } }) } };
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => currentSupabase,
}));

function buildFormData(overrides: Record<string, string> = {}, photoCount = 1) {
  const fd = new FormData();
  fd.set("display_name", overrides.display_name ?? "엄마");
  fd.set("role", overrides.role ?? "주인공 엄마");
  fd.set("personality", overrides.personality ?? "");
  fd.set("speaking_style", overrides.speaking_style ?? "");
  fd.set("representative_outfit", overrides.representative_outfit ?? "");
  for (let i = 0; i < photoCount; i++) {
    fd.append("photos", new File([new Uint8Array([1, 2, 3])], `photo-${i}.jpg`, { type: "image/jpeg" }));
  }
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  createCharacterMock.mockResolvedValue({ id: "char-new-1" });
  uploadReferenceImageMock.mockResolvedValue(undefined);
});

describe("createCharacterAction", () => {
  test("사진이 0장이면 캐릭터를 만들지 않고 에러를 반환한다 (redirect 없음)", async () => {
    const { createCharacterAction } = await import("../../lib/characters/actions");
    const result = await createCharacterAction({ ok: false }, buildFormData({}, 0));
    expect(result.ok).toBe(false);
    expect(createCharacterMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  test("이름이 비어있으면 캐릭터를 만들지 않고 에러를 반환한다", async () => {
    const { createCharacterAction } = await import("../../lib/characters/actions");
    const result = await createCharacterAction({ ok: false }, buildFormData({ display_name: "" }));
    expect(result.ok).toBe(false);
    expect(createCharacterMock).not.toHaveBeenCalled();
  });

  test("정상 생성 성공 시 ?new=1을 붙여 상세 페이지로 리다이렉트한다", async () => {
    const { createCharacterAction } = await import("../../lib/characters/actions");
    await expect(createCharacterAction({ ok: false }, buildFormData())).rejects.toThrow(RedirectSignal);
    expect(createCharacterMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith("/toon/characters/char-new-1?new=1");
  });

  test("사진 업로드가 실패해도 캐릭터를 다시 만들지 않고, 같은 캐릭터 상세 페이지로 보낸다", async () => {
    uploadReferenceImageMock.mockRejectedValueOnce(new Error("업로드 실패"));
    const { createCharacterAction } = await import("../../lib/characters/actions");
    await expect(createCharacterAction({ ok: false }, buildFormData())).rejects.toThrow(RedirectSignal);
    // 캐릭터는 정확히 한 번만 생성되어야 한다 — 실패 후 재시도해도 중복 생성되지 않는다.
    expect(createCharacterMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith("/toon/characters/char-new-1?new=1&photoError=1");
  });
});
