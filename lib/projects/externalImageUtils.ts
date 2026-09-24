/** Only the new external-image workflow uses this fixed-size import. Other projects retain 2–20 panels. */
export const EXTERNAL_IMAGE_COUNT = 11;
export const EXTERNAL_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export type ExternalImageFile = { name: string; size: number; type: string };

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
};

export function externalImageMime(file: ExternalImageFile): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const expected = MIME_BY_EXTENSION[extension];
  return expected && file.type === expected ? expected : null;
}

export function validateExternalImageFiles(files: ExternalImageFile[]): string | null {
  if (files.length !== EXTERNAL_IMAGE_COUNT) return "표지 1장과 본문 10장, 총 11장을 선택해주세요.";
  for (const file of files) {
    const error = validateExternalImageFile(file);
    if (error) return error;
  }
  return null;
}

export function validateExternalImageFile(file: ExternalImageFile): string | null {
  if (!externalImageMime(file)) return `지원하지 않는 이미지 형식입니다: ${file.name}`;
  if (file.size <= 0 || file.size > EXTERNAL_IMAGE_MAX_BYTES) return `이미지는 한 장당 10MB 이하이어야 합니다: ${file.name}`;
  return null;
}

/** Only sort when the entire set is unambiguously cover + 01..10. Otherwise preserve selection order. */
export function sortExternalImages<T extends { name: string }>(files: T[]): T[] {
  if (files.length !== EXTERNAL_IMAGE_COUNT) return [...files];
  const rank = (name: string) => {
    const stem = name.replace(/\.[^.]+$/, "").toLowerCase();
    if (stem === "cover") return 0;
    if (/^(0[1-9]|10)$/.test(stem)) return Number(stem);
    return -1;
  };
  const ranks = files.map((file) => rank(file.name));
  if (new Set(ranks).size !== EXTERNAL_IMAGE_COUNT || ranks.some((n) => n < 0)) return [...files];
  return [...files].sort((a, b) => rank(a.name) - rank(b.name));
}

export function reorderExternalImages<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
  const next = [...items];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

export function externalImageLabel(index: number): string {
  return index === 0 ? "Cover" : `Panel ${index}`;
}

export function isExternalStoragePath(path: string, userId: string, projectId: string, number: number): boolean {
  const prefix = `${userId}/${projectId}/external/${number}/`;
  return path.startsWith(prefix) && /^[0-9a-f]{8}-[0-9a-f-]{27,}_[0-9a-f]{8}-[0-9a-f-]{27,}\.(png|jpg|jpeg|webp)$/.test(path.slice(prefix.length));
}

/** Deterministic minimum rows, used only for numbers missing from a newly imported storyboard. */
export function missingExternalPanelRows(projectId: string, numbers: number[]) {
  return numbers.map((number) => ({
    project_id: projectId, panel_number: number, panel_type: number === 1 ? "cover" : "scene",
    scene: "", narration: null, dialogue: [], character_ids: [], expression: null,
    image_prompt: null, cover_title: null, cover_subtitle: null,
  }));
}
