import { describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw Error("redirected"); } }));
const createProject = vi.fn(async (_client: unknown, data: unknown) => ({ id: "new-project", data }));
vi.mock("../../lib/projects/service", () => ({ createProject: (...args: unknown[]) => createProject(...args) }));
vi.mock("../../lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) } }) }));

describe("new project panel count", () => {
  test("omitted form count falls back to 11 and never touches existing projects", async () => {
    const { createProjectAction } = await import("../../lib/projects/actions");
    const form = new FormData();
    form.set("title", "새 화"); form.set("topic", "육아 이야기");
    form.append("character_ids", "11111111-1111-4111-8111-111111111111");
    await expect(createProjectAction({ ok: true }, form)).rejects.toThrow("redirected");
    expect(createProject).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ panel_count: 11 }));
  });
});
