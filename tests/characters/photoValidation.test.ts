import { describe, expect, test } from "vitest";
import {
  MAX_FILE_SIZE_BYTES,
  detectImageFormat,
  validatePhotoCount,
  validatePhotoFile,
} from "../../lib/characters/photoValidation";

const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP_HEADER = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const GARBAGE = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

describe("detectImageFormat", () => {
  test("JPEG signature를 인식한다", () => {
    expect(detectImageFormat(JPEG_HEADER)).toBe("jpeg");
  });
  test("PNG signature를 인식한다", () => {
    expect(detectImageFormat(PNG_HEADER)).toBe("png");
  });
  test("WEBP signature를 인식한다", () => {
    expect(detectImageFormat(WEBP_HEADER)).toBe("webp");
  });
  test("알 수 없는 바이트는 null을 반환한다", () => {
    expect(detectImageFormat(GARBAGE)).toBeNull();
  });
  test("너무 짧은 바이트는 null을 반환한다", () => {
    expect(detectImageFormat(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("validatePhotoFile", () => {
  test("정상 JPG는 허용된다", () => {
    const result = validatePhotoFile({ declaredMimeType: "image/jpeg", size: 1000, bytes: JPEG_HEADER });
    expect(result.valid).toBe(true);
  });

  test("정상 PNG는 허용된다", () => {
    const result = validatePhotoFile({ declaredMimeType: "image/png", size: 1000, bytes: PNG_HEADER });
    expect(result.valid).toBe(true);
  });

  test("정상 WEBP는 허용된다", () => {
    const result = validatePhotoFile({ declaredMimeType: "image/webp", size: 1000, bytes: WEBP_HEADER });
    expect(result.valid).toBe(true);
  });

  test("빈 파일은 거부된다", () => {
    const result = validatePhotoFile({ declaredMimeType: "image/jpeg", size: 0, bytes: JPEG_HEADER });
    expect(result.valid).toBe(false);
  });

  test("허용 목록에 없는 MIME(SVG 등)은 거부된다", () => {
    const result = validatePhotoFile({
      declaredMimeType: "image/svg+xml",
      size: 1000,
      bytes: GARBAGE,
    });
    expect(result.valid).toBe(false);
  });

  test("최대 크기를 초과하면 거부된다", () => {
    const result = validatePhotoFile({
      declaredMimeType: "image/jpeg",
      size: MAX_FILE_SIZE_BYTES + 1,
      bytes: JPEG_HEADER,
    });
    expect(result.valid).toBe(false);
  });

  test("확장자/MIME은 JPG인데 실제 바이트는 PNG면 거부된다 (magic byte 위조 방지)", () => {
    const result = validatePhotoFile({
      declaredMimeType: "image/jpeg",
      size: 1000,
      bytes: PNG_HEADER,
    });
    expect(result.valid).toBe(false);
  });
});

describe("validatePhotoCount", () => {
  test("0장은 거부된다", () => {
    expect(validatePhotoCount(0).valid).toBe(false);
  });
  test("1장은 허용된다", () => {
    expect(validatePhotoCount(1).valid).toBe(true);
  });
  test("5장은 허용된다", () => {
    expect(validatePhotoCount(5).valid).toBe(true);
  });
  test("6장은 거부된다", () => {
    expect(validatePhotoCount(6).valid).toBe(false);
  });
});
