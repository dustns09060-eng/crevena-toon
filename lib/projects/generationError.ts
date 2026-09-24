const BUSY_ERROR_PATTERN = /too many concurrent|resource[_ ]?exhausted|rate.?limit|\b429\b/i;
const TEMPORARY_ERROR_PATTERN =
  /\b503\b|service unavailable|temporarily unavailable|deadline exceeded|timeout/i;

export function getGenerationErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  if (BUSY_ERROR_PATTERN.test(message)) {
    return "현재 이미지 생성 요청이 몰렸어요. 30~60초 후 '이 컷 다시 만들기'를 한 번만 눌러주세요.";
  }

  if (TEMPORARY_ERROR_PATTERN.test(message)) {
    return "이미지 생성 서비스가 잠시 불안정해요. 잠시 후 다시 시도해주세요.";
  }

  return message || fallback;
}
