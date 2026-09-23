/**
 * 참조 사진 업로드 검증. 확장자/선언된 MIME은 신뢰하지 않고
 * magic byte(파일 시그니처)로 실제 포맷을 확인한다. SVG는 허용
 * 목록에 아예 없으므로 자동으로 거부된다.
 */

export const MIN_PHOTOS = 1;
export const MAX_PHOTOS = 5;
export const RECOMMENDED_MIN_PHOTOS = 2;
export const RECOMMENDED_MAX_PHOTOS = 5;
export const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB

export type DetectedImageFormat = "jpeg" | "png" | "webp";

const MIME_TO_FORMAT: Record<string, DetectedImageFormat> = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

export const ALLOWED_MIME_TYPES = Object.keys(MIME_TO_FORMAT);

export function detectImageFormat(bytes: Uint8Array): DetectedImageFormat | null {
  if (bytes.length < 12) return null;

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }

  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }

  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }

  return null;
}

export interface PhotoFileInput {
  declaredMimeType: string;
  size: number;
  bytes: Uint8Array;
}

export type PhotoValidationResult = { valid: true; format: DetectedImageFormat } | { valid: false; reason: string };

export function validatePhotoFile(file: PhotoFileInput): PhotoValidationResult {
  if (file.size <= 0) {
    return { valid: false, reason: "빈 파일은 업로드할 수 없습니다." };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      reason: `파일 크기는 ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB를 초과할 수 없습니다.`,
    };
  }

  const declaredFormat = MIME_TO_FORMAT[file.declaredMimeType.toLowerCase()];
  if (!declaredFormat) {
    return { valid: false, reason: "JPG, PNG, WEBP 형식만 업로드할 수 있습니다." };
  }

  const actualFormat = detectImageFormat(file.bytes);
  if (!actualFormat) {
    return {
      valid: false,
      reason: "이미지 파일 형식을 확인할 수 없습니다 (손상되었거나 지원하지 않는 형식).",
    };
  }

  if (actualFormat !== declaredFormat) {
    return {
      valid: false,
      reason: "선언된 파일 형식과 실제 파일 내용이 일치하지 않습니다.",
    };
  }

  return { valid: true, format: actualFormat };
}

export type PhotoCountValidationResult = { valid: true } | { valid: false; reason: string };

export function validatePhotoCount(count: number): PhotoCountValidationResult {
  if (count < MIN_PHOTOS) {
    return { valid: false, reason: "사진을 최소 1장 이상 업로드해주세요." };
  }
  if (count > MAX_PHOTOS) {
    return { valid: false, reason: `사진은 최대 ${MAX_PHOTOS}장까지 업로드할 수 있습니다.` };
  }
  return { valid: true };
}

/** 원본 파일명을 절대 Storage 경로로 쓰지 않는다 — UUID 기반 경로 생성. */
export function buildReferenceStoragePath(
  userId: string,
  characterId: string,
  format: DetectedImageFormat
): string {
  const ext = format === "jpeg" ? "jpg" : format;
  const id = crypto.randomUUID();
  return `${userId}/${characterId}/${id}.${ext}`;
}
