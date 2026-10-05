import { afterEach, expect, test, vi } from "vitest";
import { generateImageFromPrompt } from "../../src/providers/openai";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
test("text-only characters use image generations, never edits without a reference", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({data:[{b64_json:Buffer.from("test-image").toString("base64")}]}) });
  vi.stubGlobal("fetch", request);
  expect((await generateImageFromPrompt("original character", [])).toString()).toBe("test-image");
  expect(request).toHaveBeenCalledWith("https://api.openai.com/v1/images/generations", expect.objectContaining({method:"POST", body:expect.stringContaining("original character")}));
});
test("provider failures do not return an invalid image", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok:false,status:429}));
  await expect(generateImageFromPrompt("original character", [])).rejects.toThrow("429");
});
