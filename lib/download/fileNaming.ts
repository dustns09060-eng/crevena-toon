/**
 * STEP 8 §5 — 전체 이미지 저장 시 Instagram 업로드 순서가 명확하도록
 * 01.png, 02.png ... 형식의 파일명을 만든다. ZIP 압축 자체(JSZip,
 * 브라우저 전용)와 분리한 순수 함수라 Node 테스트에서 결정적으로
 * 검증할 수 있다.
 */
export function buildPanelFileName(panelIndex: number): string {
  return `${String(panelIndex + 1).padStart(2, "0")}.png`;
}

export interface ZipEntryInput {
  panelNumber: number;
  bytes: Uint8Array;
}

export interface ZipEntry {
  filename: string;
  bytes: Uint8Array;
}

/**
 * panelNumber 순서대로 정렬한 뒤 01.png, 02.png ... 파일명을 매긴다.
 * 실제 JSZip 호출은 이 목록을 그대로 순회하기만 하면 되므로, 파일명
 * 규칙 자체는 브라우저/ZIP 라이브러리 없이도 테스트할 수 있다.
 */
export function buildZipEntries(panels: ZipEntryInput[]): ZipEntry[] {
  return [...panels]
    .sort((a, b) => a.panelNumber - b.panelNumber)
    .map((p, index) => ({ filename: buildPanelFileName(index), bytes: p.bytes }));
}

/** STEP 8 §6 — project-title.zip 파일명. 파일시스템에 안전하지 않은 문자만 제거한다. */
export function buildZipFileName(projectTitle: string): string {
  const safe = projectTitle.trim().replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "-");
  return `${safe || "instatoon"}.zip`;
}
