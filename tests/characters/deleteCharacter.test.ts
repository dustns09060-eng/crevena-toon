import { describe, expect, test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteCharacter } from "../../lib/characters/service";

/**
 * deleteCharacter()는 실제 Supabase(PostgREST + Storage)를 호출하므로,
 * "프로젝트 연결 여부에 따라 삭제를 차단/허용하는 분기 로직" 자체는
 * 여기서 최소한의 가짜 클라이언트로 단위 테스트한다. 실제 RLS/Storage
 * 동작은 STEP 1.5/1.6과 동일하게 스테이징 환경에서 직접 검증했다
 * (PGlite는 Supabase Storage를 흉내낼 수 없어 vitest로는 불가능).
 */
function createMockSupabase(opts: {
  linkedCount: number;
  refs: { storage_path: string }[];
}): SupabaseClient {
  const removedPaths: string[][] = [];
  let deletedCharacterId: string | null = null;

  const mock = {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              if (table === "toon_project_characters") {
                return Promise.resolve({ count: opts.linkedCount, error: null });
              }
              if (table === "toon_character_references") {
                return Promise.resolve({ data: opts.refs, error: null });
              }
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
        delete() {
          return {
            eq(_col: string, val: string) {
              if (table === "toon_characters") deletedCharacterId = val;
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
    storage: {
      from() {
        return {
          remove(paths: string[]) {
            removedPaths.push(paths);
            return Promise.resolve({ error: null });
          },
        };
      },
    },
    __test: { removedPaths, get deletedCharacterId() { return deletedCharacterId; } },
  };

  return mock as unknown as SupabaseClient;
}

describe("deleteCharacter", () => {
  test("프로젝트에 연결된 캐릭터는 삭제가 차단된다", async () => {
    const supabase = createMockSupabase({ linkedCount: 2, refs: [] });
    const result = await deleteCharacter(supabase, "char-1");
    expect(result.deleted).toBe(false);
    if (!result.deleted) {
      expect(result.reason).toBe("linked_to_projects");
      expect(result.projectCount).toBe(2);
    }
  });

  test("프로젝트에 연결되지 않은 캐릭터는 삭제에 성공하고 참조 이미지도 함께 정리된다", async () => {
    const supabase = createMockSupabase({
      linkedCount: 0,
      refs: [{ storage_path: "user/char/a.jpg" }, { storage_path: "user/char/b.jpg" }],
    });
    const result = await deleteCharacter(supabase, "char-1");
    expect(result.deleted).toBe(true);

    const testHooks = (supabase as unknown as { __test: { removedPaths: string[][] } }).__test;
    expect(testHooks.removedPaths).toEqual([["user/char/a.jpg", "user/char/b.jpg"]]);
  });

  test("참조 이미지가 없는 캐릭터도 정상 삭제된다 (Storage 정리 호출 없음)", async () => {
    const supabase = createMockSupabase({ linkedCount: 0, refs: [] });
    const result = await deleteCharacter(supabase, "char-1");
    expect(result.deleted).toBe(true);

    const testHooks = (supabase as unknown as { __test: { removedPaths: string[][] } }).__test;
    expect(testHooks.removedPaths).toEqual([]);
  });
});
