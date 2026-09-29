"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { getPanelEditorData, saveBubbleLayoutAction, saveCoverLayoutAction, saveFinalRenderAction } from "../../../../../lib/projects/editor";
import { smartLayoutPanel } from "../../../../../lib/editor/smartLayout";
import { renderPanelToCanvas, fetchAsObjectUrl, canvasToPngBlob, FONT_FAMILY } from "../../../../../lib/editor/renderPanel";
import { getFinalImageDimensions } from "../../../../../src/providers/finalImageConfig";

export default function QualityRefresh({ projectId, disabled, onRunningChange }: { projectId: string; disabled: boolean; onRunningChange: (running: boolean) => void }) {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  async function refresh() {
    if (busy.current || disabled) return;
    busy.current = true; setRunning(true); onRunningChange(true);
    try {
      if (!navigator.locks) throw new Error("최신 브라우저에서 실행해주세요.");
      await navigator.locks.request(`toon-auto-${projectId}`, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error("다른 탭에서 제작 중입니다.");
        const data = await getPanelEditorData(projectId);
        if (!data.ok) throw new Error(data.message);
        // Validate every layout before replacing any saved output.
        const prepared = data.panels.map(source => {
          const result = smartLayoutPanel(source, true, true);
          if (result.status === "REVIEW_REQUIRED") throw new Error(`${source.panelNumber}컷: ${result.reason}`);
          return { ...source, ...result.panel };
        });
        await document.fonts.load(`38px ${FONT_FAMILY}`); await document.fonts.ready;
        for (let i = 0; i < prepared.length; i++) {
          const panel = prepared[i];
          setMessage(`${i + 1}/${prepared.length}컷 재합성 중 — 화면을 열어두세요.`);
          if (!panel.rawImageSignedUrl) throw new Error("승인된 이미지가 없습니다.");
          const url = await fetchAsObjectUrl(panel.rawImageSignedUrl);
          try {
            const canvas = document.createElement("canvas");
            await renderPanelToCanvas(canvas, { ...panel, ...getFinalImageDimensions(), imageObjectUrl: url });
            const blob = await canvasToPngBlob(canvas);
            const saved = panel.panelType === "cover"
              ? await saveCoverLayoutAction(panel.id, panel.coverTitle, panel.coverSubtitle, panel.coverTitleBubble)
              : await saveBubbleLayoutAction(panel.id, panel.dialogue, panel.narration, panel.narrationBubble);
            if (!saved.ok) throw new Error(saved.message);
            const final = await saveFinalRenderAction(panel.id, new File([blob], `panel-${panel.panelNumber}.png`, { type: "image/png" }));
            if (!final.ok) throw new Error(final.message);
          } finally { URL.revokeObjectURL(url); }
        }
        setMessage("모든 컷의 가독성 개선과 재합성이 완료되었습니다.");
      });
    } catch (e) { setMessage(e instanceof Error ? e.message : "재합성에 실패했습니다. 저장된 컷은 유지됩니다."); }
    finally { busy.current = false; setRunning(false); onRunningChange(false); }
  }
  return <section style={{ borderTop: "1px solid #ddd", marginTop: 24, paddingTop: 16 }}>
    <h3>완성본 가독성 개선</h3>
    <p>기존 그림과 대사는 유지하고, 말풍선을 큰 글씨와 꼬리가 있는 배치로 다시 만듭니다. 흐린 여백은 밝은 종이색으로 바꿉니다. 기존 배치와 완성 PNG를 교체합니다.</p>
    <p>AI 생성 비용은 없습니다. 얼굴이나 그림 속 문자는 바뀌지 않으며, 말풍선이 얼굴을 가리는지는 완성본에서 확인해주세요.</p>
    <button className="btn btn-primary" disabled={disabled || running} onClick={() => void refresh()}>{running ? "재합성 중…" : "전체 컷 가독성 개선 및 재합성"}</button>
    <p role="status">{message}</p>
    {!running && <Link href={`/toon/projects/${projectId}/final`}>완성본 확인</Link>}
  </section>;
}
