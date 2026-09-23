"use client";

import JSZip from "jszip";
import { buildZipEntries, buildZipFileName, type ZipEntryInput } from "./fileNaming";

/**
 * STEP 8 §4 — "브라우저 preview를 screenshot해서 저장하면 안 된다"는
 * 요구를 지키기 위해, Storage에 저장된 실제 PNG 바이트를 fetch로 받아
 * 그대로 저장한다(STEP7의 fetchAsObjectUrl과 같은 이유로 fetch→blob→
 * objectURL을 쓴다 — cross-origin 서명 URL이라도 blob은 항상 same-origin
 * 이라 안정적으로 다운로드된다).
 */
function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadSingleFinalImage(signedUrl: string, filename: string): Promise<void> {
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error("이미지를 다운로드하지 못했습니다.");
  const blob = await res.blob();
  triggerBlobDownload(blob, filename);
}

/**
 * STEP 8 §5, §6 — 여러 final 이미지를 하나의 ZIP으로 묶어 한 번의
 * 액션으로 받게 한다. 순수하게 브라우저에서만 수행하며, 어떤 Server
 * Action에도 이 바이트를 다시 업로드하지 않는다(§7 — ZIP은 다운로드
 * 전용).
 */
export async function downloadAllFinalImagesAsZip(
  panels: { panelNumber: number; signedUrl: string }[],
  projectTitle: string
): Promise<void> {
  const zip = new JSZip();

  const entriesInput: ZipEntryInput[] = [];
  for (const panel of panels) {
    const res = await fetch(panel.signedUrl);
    if (!res.ok) throw new Error(`컷 ${panel.panelNumber} 이미지를 다운로드하지 못했습니다.`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    entriesInput.push({ panelNumber: panel.panelNumber, bytes });
  }

  const entries = buildZipEntries(entriesInput);
  for (const entry of entries) {
    zip.file(entry.filename, entry.bytes);
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  triggerBlobDownload(zipBlob, buildZipFileName(projectTitle));
}
