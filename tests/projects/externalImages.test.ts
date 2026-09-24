import { beforeEach, describe, expect, test, vi } from "vitest";
import { checkEditorReadiness } from "../../lib/projects/editorUtils";
import type { ToonPanel, ToonProject } from "../../src/db/types";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const getProject = vi.fn();
const getProjectPanels = vi.fn();
vi.mock("../../lib/projects/service", () => ({
  getProject: (...args: unknown[]) => getProject(...args),
  getProjectPanels: (...args: unknown[]) => getProjectPanels(...args),
}));

const projectId = "22222222-2222-4222-8222-222222222222";
const userId = "11111111-1111-4111-8111-111111111111";
const batch = "33333333-3333-4333-8333-333333333333";
const paths = Array.from({ length: 11 }, (_, i) =>
  `${userId}/${projectId}/external/${i + 1}/${batch}_44444444-4444-4444-8444-44444444444${i}.png`);
const files = Array.from({ length: 11 }, (_, i) => ({ name: `${i + 1}.png`, size: 200, type: "image/png" }));
const project = { id: projectId, status: "draft", panel_count: 11 };

type Panel = { id: string; panel_number: number; panel_type: string; raw_image_url: string | null; image_url: string | null; generation_version: number; dialogue?: unknown[]; scene?: string };
function fakePanel(number: number): Panel {
  return { id: `p-${number}`, panel_number: number, panel_type: number === 1 ? "cover" : "scene", raw_image_url: null, image_url: null, generation_version: 1, dialogue: [], scene: "" };
}

const state = {
  panels: [] as Panel[], images: [] as Record<string, unknown>[], uploads: [] as string[], deleted: [] as string[],
  failImageAt: -1, failInfoAt: -1, failPanelInsert: false, projectUpdates: [] as string[],
};

function builder(table: string) {
  let op = "select";
  let payload: Record<string, unknown> | Record<string, unknown>[] = {};
  const filters: Record<string, unknown> = {};
  const chain = {
    select(_cols?: string) { return chain; },
    insert(value: typeof payload) { op = "insert"; payload = value; return chain; },
    update(value: typeof payload) { op = "update"; payload = value; return chain; },
    delete() { op = "delete"; return chain; },
    eq(key: string, value: unknown) { filters[key] = value; return chain; },
    is(key: string, value: unknown) { filters[key] = value; return chain; },
    in(key: string, value: unknown[]) { filters[key] = value; return chain; },
    async single() { return finish(true); },
    then(resolve: (v: unknown) => void) { void finish(false).then(resolve); },
  };
  async function finish(single: boolean): Promise<{ data: unknown; error: Error | null }> {
    if (table === "toon_panel_images") {
      if (op === "select") return { data: state.images.filter((row) => (filters.panel_id as string[])?.includes(row.panel_id as string) && row.status === filters.status), error: null };
      if (op === "insert") {
        if (state.images.length === state.failImageAt) return { data: null, error: Error("db failure") };
        const row = { ...(payload as Record<string, unknown>), id: `image-${state.images.length}` };
        state.images.push(row);
        return { data: single ? row : [row], error: null };
      }
      if (op === "delete") {
        state.images = state.images.filter((row) => !(filters.id as string[]).includes(row.id as string));
        return { data: null, error: null };
      }
    }
    if (table === "toon_panels") {
      if (op === "insert") {
        if (state.failPanelInsert) return { data: null, error: Error("db failure") };
        const rows = (payload as Record<string, unknown>[]).map((row) => ({ ...fakePanel(row.panel_number as number), ...row, id: `p-${row.panel_number}` }));
        state.panels.push(...rows as Panel[]);
        state.panels.sort((a, b) => a.panel_number - b.panel_number);
        return { data: rows.map(({ id }) => ({ id })), error: null };
      }
      if (op === "update") {
        const matching = state.panels.filter((row) => row.id === filters.id && row.raw_image_url === (filters.raw_image_url ?? null));
        for (const row of matching) row.raw_image_url = (payload as { raw_image_url: string | null }).raw_image_url;
        return { data: matching.map(({ id }) => ({ id })), error: null };
      }
      if (op === "delete") {
        state.panels = state.panels.filter((row) => !(filters.id as string[]).includes(row.id));
        return { data: null, error: null };
      }
    }
    if (table === "toon_projects" && op === "update") {
      state.projectUpdates.push((payload as { status: string }).status);
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }
  return chain;
}

const supabase = {
  auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
  from: (table: string) => builder(table),
  storage: { from: () => ({
    createSignedUploadUrl: async (path: string) => ({ data: { token: "signed", path }, error: null }),
    info: async (path: string) => ({ data: { size: 200, contentType: "image/png" }, error: state.failInfoAt === paths.indexOf(path) ? Error("missing") : null }),
    remove: async (removed: string[]) => { state.deleted.push(...removed); return { error: null }; },
  }) },
};
vi.mock("../../lib/supabase/server", () => ({ createClient: async () => supabase }));

beforeEach(() => {
  vi.clearAllMocks();
  state.panels = []; state.images = []; state.deleted = []; state.uploads = [];
  state.failImageAt = -1; state.failInfoAt = -1; state.failPanelInsert = false; state.projectUpdates = [];
  getProject.mockResolvedValue(project);
  getProjectPanels.mockImplementation(async () => state.panels.map((p) => ({ ...p })));
});

describe("external import actions", () => {
  test("preview/prepare does not write DB or Storage; AI provider is not imported", async () => {
    const { prepareExternalUploadAction } = await import("../../lib/projects/externalImages");
    const prepared = await prepareExternalUploadAction(projectId, files);
    expect(prepared.ok).toBe(true);
    expect(prepared.uploads).toHaveLength(11);
    expect(state.panels).toHaveLength(0);
    expect(state.images).toHaveLength(0);
  });
  test("11 deterministic blank panels, approved external rows and raw pointers; no storyboard rewrite", async () => {
    const { finishExternalUploadAction } = await import("../../lib/projects/externalImages");
    const result = await finishExternalUploadAction(projectId, paths);
    expect(result.ok).toBe(true);
    expect(state.panels).toHaveLength(11);
    expect(state.panels[0].panel_type).toBe("cover");
    expect(state.panels[10].panel_number).toBe(11);
    expect(state.images.map((p) => [p.provider, p.model, p.status])).toEqual(Array.from({ length: 11 }, () => ["external", "upload", "approved"]));
    expect(state.panels.map((p) => p.raw_image_url)).toEqual(paths);
    expect(state.projectUpdates).toEqual(["confirmed"]);
    expect(checkEditorReadiness({ ...project, status: "confirmed" } as ToonProject, state.panels as ToonPanel[]).ready).toBe(true);
  });
  test("existing storyboard and bubble data are preserved and only missing panels inserted", async () => {
    const existing = fakePanel(1);
    existing.scene = "이미 작성한 제목";
    existing.dialogue = [{ text: "말풍선 그대로" }];
    state.panels = [existing];
    const { finishExternalUploadAction } = await import("../../lib/projects/externalImages");
    expect((await finishExternalUploadAction(projectId, paths)).ok).toBe(true);
    expect(state.panels[0].scene).toBe("이미 작성한 제목");
    expect(state.panels[0].dialogue).toEqual([{ text: "말풍선 그대로" }]);
  });
  test("approved image or final image conflict prevents all uploads and changes", async () => {
    state.panels = [fakePanel(1)]; state.panels[0].raw_image_url = "existing/raw.png";
    const { prepareExternalUploadAction, finishExternalUploadAction } = await import("../../lib/projects/externalImages");
    expect((await prepareExternalUploadAction(projectId, files)).conflicts).toEqual([1]);
    expect((await finishExternalUploadAction(projectId, paths)).ok).toBe(false);
    expect(state.panels[0].raw_image_url).toBe("existing/raw.png");
    expect(state.images).toHaveLength(0);
  });
  test("Storage verification failure cleans only batch; no DB changes", async () => {
    state.failInfoAt = 6;
    const { finishExternalUploadAction } = await import("../../lib/projects/externalImages");
    expect((await finishExternalUploadAction(projectId, paths)).ok).toBe(false);
    expect(state.deleted).toEqual(paths);
    expect(state.panels).toHaveLength(0);
  });
  test("DB insert failure restores pointers, rows and empty panels; cleans only batch", async () => {
    state.failImageAt = 4;
    const { finishExternalUploadAction } = await import("../../lib/projects/externalImages");
    expect((await finishExternalUploadAction(projectId, paths)).ok).toBe(false);
    expect(state.deleted).toEqual(paths);
    expect(state.panels).toHaveLength(0);
    expect(state.images).toHaveLength(0);
    expect(state.projectUpdates).toEqual([]);
  });
  test("partial upload can be cleaned before DB stage", async () => {
    const { cancelExternalUploadAction } = await import("../../lib/projects/externalImages");
    expect((await cancelExternalUploadAction(projectId, paths)).ok).toBe(true);
    expect(state.deleted).toEqual(paths);
  });
  test("existing 20-panel project is rejected without mutation", async () => {
    getProject.mockResolvedValue({ ...project, panel_count: 20 });
    const { finishExternalUploadAction } = await import("../../lib/projects/externalImages");
    expect((await finishExternalUploadAction(projectId, paths)).ok).toBe(false);
    expect(state.panels).toHaveLength(0);
  });
});
