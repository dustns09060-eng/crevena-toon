import { describe, expect, test, vi } from "vitest";
import { uploadExternalBatch } from "../../lib/projects/externalUploadFlow";

const paths = Array.from({ length: 11 }, (_, i) => ({ path: `batch/${i + 1}` }));
describe("external direct upload rollback", () => {
  test("partial Storage upload failure cleans this entire batch and never reaches DB", async () => {
    const cleanup = vi.fn(async () => {});
    const finish = vi.fn(async () => {});
    await expect(uploadExternalBatch(paths, async (_, i) => { if (i === 5) throw Error("upload failed"); }, finish, cleanup)).rejects.toThrow("upload failed");
    expect(finish).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledWith(paths.map((item) => item.path));
  });
  test("DB failure cleans only this batch; success cleans nothing", async () => {
    const cleanup = vi.fn(async () => {});
    await expect(uploadExternalBatch(paths, async () => {}, async () => { throw Error("db failed"); }, cleanup)).rejects.toThrow("db failed");
    expect(cleanup).toHaveBeenCalledTimes(1);
    cleanup.mockClear();
    await uploadExternalBatch(paths, async () => {}, async () => {}, cleanup);
    expect(cleanup).not.toHaveBeenCalled();
  });
});
