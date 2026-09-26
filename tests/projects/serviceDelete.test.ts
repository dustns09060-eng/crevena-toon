import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

interface MockConfig {
  project?: Record<string, unknown> | null;
  panels?: Record<string, unknown>[];
  storageFiles?: Record<string, { name: string }[]>;
}

function createSupabaseMock(config: MockConfig) {
  const calls: Record<string, unknown[]> = {};
  function record(key: string, arg?: unknown) {
    (calls[key] ??= []).push(arg);
  }

  function makeBuilder(table: string) {
    let order: unknown;
    const builder: Record<string, unknown> = {
      select() {
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
      order(col: string, opts: unknown) {
        order = { col, opts };
        return builder;
      },
      maybeSingle() {
        if (table === "toon_projects") return Promise.resolve({ data: config.project ?? null, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve: (v: { data?: unknown[]; error: null }) => void) {
        void order;
        if (table === "toon_panels") return resolve({ data: config.panels ?? [], error: null });
        resolve({ error: null });
      },
    };
    return builder;
  }

  return {
    _calls: calls,
    storage: {
      from(bucket: string) {
        return {
          list: async (prefix: string) => {
            record(`storage.${bucket}.list`, prefix);
            return { data: config.storageFiles?.[prefix] ?? [], error: null };
          },
          remove: async (paths: string[]) => {
            record(`storage.${bucket}.remove`, paths);
            return { error: null };
          },
        };
      },
    },
    from: (t: string) => makeBuilder(t),
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

const OWNED_PROJECT = { id: "proj-1", user_id: "user-a", title: "제목", panel_count: 1, status: "confirmed" };
const PANEL = { id: "panel-1", project_id: "proj-1", panel_number: 1 };

describe("deleteProject는 Character Sheet 버킷/테이블을 절대 건드리지 않는다", () => {
  test("소스 코드에 toon-character-sheets 버킷/toon_characters 테이블 호출이 없다 (주석 언급은 허용)", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../lib/projects/service.ts"), "utf-8");
    expect(source).not.toMatch(/storage\.from\(["']toon-character-sheets["']\)/);
    expect(source).not.toMatch(/\.from\(["']toon_characters["']\)/);
  });
});

describe("deleteProject", () => {
  test("존재하지 않는(또는 타인) 프로젝트는 거부되고 Storage에 손대지 않는다", async () => {
    const supabase = createSupabaseMock({ project: null });
    const { deleteProject } = await import("../../lib/projects/service");

    const result = await deleteProject(supabase, "proj-1");
    expect(result.deleted).toBe(false);
    expect((supabase as unknown as { _calls: Record<string, unknown[]> })._calls["storage.toon-panels.remove"]).toBeUndefined();
  });

  test("raw/final/external 폴더의 모든 파일을 나열해서 지운 뒤 프로젝트 행을 삭제한다", async () => {
    const supabase = createSupabaseMock({
      project: OWNED_PROJECT,
      panels: [PANEL],
      storageFiles: {
        "user-a/proj-1/raw/1": [{ name: "gen-1.png" }],
        "user-a/proj-1/final/1": [{ name: "render-1.png" }, { name: "render-2.png" }],
        "user-a/proj-1/external/1": [{ name: "uploaded.png" }],
      },
    });
    const { deleteProject } = await import("../../lib/projects/service");

    const result = await deleteProject(supabase, "proj-1");
    expect(result.deleted).toBe(true);

    const calls = (supabase as unknown as { _calls: Record<string, unknown[]> })._calls;
    const removedPaths = calls["storage.toon-panels.remove"][0] as string[];
    expect(removedPaths.sort()).toEqual(
      [
        "user-a/proj-1/raw/1/gen-1.png",
        "user-a/proj-1/final/1/render-1.png",
        "user-a/proj-1/final/1/render-2.png",
        "user-a/proj-1/external/1/uploaded.png",
      ].sort()
    );
    expect(calls["toon_projects.delete"]).toHaveLength(1);
  });

  test("Storage에 파일이 없으면 remove를 호출하지 않는다", async () => {
    const supabase = createSupabaseMock({ project: OWNED_PROJECT, panels: [PANEL], storageFiles: {} });
    const { deleteProject } = await import("../../lib/projects/service");

    await deleteProject(supabase, "proj-1");
    const calls = (supabase as unknown as { _calls: Record<string, unknown[]> })._calls;
    expect(calls["storage.toon-panels.remove"]).toBeUndefined();
  });
  test("해당 프로젝트의 analysis cache만 삭제하고 다른 프로젝트는 보존한다", async () => {
    const supabase = createSupabaseMock({ project: OWNED_PROJECT, panels: [PANEL], storageFiles: {
      "user-a/proj-1/analysis/panel-1": [{ name: "image-row-1" }],
      "user-a/proj-1/analysis/panel-1/image-row-1": [{ name: "v1-hash.json" }, { name: "v1-hash.json.lock" }],
      "user-a/proj-2/analysis/panel-1/image-row-1": [{ name: "unrelated.json" }],
    } });
    await (await import("../../lib/projects/service")).deleteProject(supabase, "proj-1");
    const calls = (supabase as unknown as { _calls: Record<string, unknown[]> })._calls;
    expect(calls["storage.toon-panels.remove"]).toEqual([[
      "user-a/proj-1/analysis/panel-1/image-row-1/v1-hash.json",
      "user-a/proj-1/analysis/panel-1/image-row-1/v1-hash.json.lock",
    ]]);
    expect((calls["storage.toon-panels.list"] as string[]).every((path) => !path.includes("proj-2"))).toBe(true);
  });
});
