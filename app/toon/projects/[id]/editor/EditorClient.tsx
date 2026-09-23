"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorPanelData } from "../../../../../lib/projects/editor";
import { saveBubbleLayoutAction, saveCoverLayoutAction, saveFinalRenderAction } from "../../../../../lib/projects/editor";
import {
  clampBubbleRect,
  getDefaultBubbleForIndex,
  getDefaultCoverTitleBubble,
  getDefaultNarrationBubble,
} from "../../../../../lib/editor/bubbleLayout";
import { canvasToPngBlob, fetchAsObjectUrl, renderPanelToCanvas, type RenderedForeground } from "../../../../../lib/editor/renderPanel";
import { getFinalImageDimensions } from "../../../../../src/providers/finalImageConfig";
import type { ProjectCharacterContext } from "../../../../../lib/projects/service";
import type { ToonBubbleStyle } from "../../../../../src/db/types";

type Selection = { kind: "dialogue"; id: string } | { kind: "narration" } | { kind: "cover" } | null;

/** overlay(canvas와 같은 비율로 CSS 표시되는 컨테이너) 기준 좌표를 계산하기 위한 fallback.
 * 이미지가 아직 로드되지 않아 foreground rect를 모를 때는 canvas 전체를 foreground로 간주한다. */
function fallbackForeground(width: number, height: number): RenderedForeground {
  return { offsetX: 0, offsetY: 0, drawWidth: width, drawHeight: height };
}

const BUBBLE_STYLE_LABELS: Record<ToonBubbleStyle, string> = {
  round: "일반 말풍선",
  thought: "생각 말풍선",
  emphasis: "강조 말풍선",
};

export default function EditorClient({
  initialPanels,
  characters,
  initialPanelIndex = 0,
}: {
  initialPanels: EditorPanelData[];
  characters: ProjectCharacterContext[];
  initialPanelIndex?: number;
}) {
  const [panels, setPanels] = useState<EditorPanelData[]>(initialPanels);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [currentIndex, setCurrentIndex] = useState(
    initialPanelIndex >= 0 && initialPanelIndex < initialPanels.length ? initialPanelIndex : 0
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [finalPreviewUrl, setFinalPreviewUrl] = useState<string | null>(null);
  const [foregroundRect, setForegroundRect] = useState<RenderedForeground | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const objectUrlCache = useRef<Map<string, string>>(new Map());
  const dragState = useRef<{
    target: Selection;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const panel = panels[currentIndex];
  const dims = useMemo(() => getFinalImageDimensions(), []);

  function updatePanel(panelId: string, updater: (p: EditorPanelData) => EditorPanelData) {
    setPanels((prev) => prev.map((p) => (p.id === panelId ? updater(p) : p)));
    setDirty((prev) => ({ ...prev, [panelId]: true }));
  }

  // STEP 7 §8 — 미리보기용 canvas를 최종 해상도(1080x1080)로 그리고
  // CSS로만 축소 표시한다. 이렇게 하면 "최종 이미지 만들기"가 호출하는
  // renderPanelToCanvas()와 완전히 동일한 계산을 그대로 재사용하므로
  // 미리보기와 실제 결과가 어긋날 수 없다.
  useEffect(() => {
    let cancelled = false;
    async function draw() {
      if (!panel?.rawImageSignedUrl || !canvasRef.current) return;
      let objectUrl = objectUrlCache.current.get(panel.id);
      if (!objectUrl) {
        try {
          objectUrl = await fetchAsObjectUrl(panel.rawImageSignedUrl);
          objectUrlCache.current.set(panel.id, objectUrl);
        } catch {
          setMessage("원본 이미지를 불러오지 못했습니다.");
          return;
        }
      }
      if (cancelled || !canvasRef.current) return;
      const foreground = await renderPanelToCanvas(canvasRef.current, {
        imageObjectUrl: objectUrl,
        panelType: panel.panelType,
        dialogue: panel.dialogue,
        narration: panel.narration,
        narrationBubble: panel.narrationBubble,
        coverTitle: panel.coverTitle,
        coverSubtitle: panel.coverSubtitle,
        coverTitleBubble: panel.coverTitleBubble,
        width: dims.width,
        height: dims.height,
      });
      if (!cancelled) setForegroundRect(foreground);
    }
    draw();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    panel?.id,
    panel?.panelType,
    panel?.dialogue,
    panel?.narration,
    panel?.narrationBubble,
    panel?.coverTitle,
    panel?.coverSubtitle,
    panel?.coverTitleBubble,
    dims.width,
    dims.height,
  ]);

  function goToPanel(index: number) {
    if (index === currentIndex) return;
    if (dirty[panel.id]) {
      const ok = window.confirm("저장하지 않은 변경사항이 있습니다. 저장하지 않고 이동할까요?");
      if (!ok) return;
    }
    setSelection(null);
    setFinalPreviewUrl(null);
    setMessage(null);
    setForegroundRect(null);
    setCurrentIndex(index);
  }

  function handleTextChange(itemId: string, text: string) {
    updatePanel(panel.id, (p) => ({
      ...p,
      dialogue: p.dialogue.map((d) => (d.id === itemId ? { ...d, text } : d)),
    }));
  }

  function handleCharacterChange(itemId: string, characterId: string) {
    updatePanel(panel.id, (p) => ({
      ...p,
      dialogue: p.dialogue.map((d) => (d.id === itemId ? { ...d, character_id: characterId } : d)),
    }));
  }

  function handleStyleChange(itemId: string, style: ToonBubbleStyle) {
    updatePanel(panel.id, (p) => ({
      ...p,
      dialogue: p.dialogue.map((d) => (d.id === itemId && d.bubble ? { ...d, bubble: { ...d.bubble, style } } : d)),
    }));
  }

  function handleFontSizeChange(itemId: string, fontSize: number) {
    updatePanel(panel.id, (p) => ({
      ...p,
      dialogue: p.dialogue.map((d) =>
        d.id === itemId && d.bubble ? { ...d, bubble: { ...d.bubble, font_size: fontSize } } : d
      ),
    }));
  }

  function handleSizeChange(itemId: string, field: "width" | "height", value: number) {
    updatePanel(panel.id, (p) => ({
      ...p,
      dialogue: p.dialogue.map((d) =>
        d.id === itemId && d.bubble ? { ...d, bubble: clampBubbleRect({ ...d.bubble, [field]: value }) } : d
      ),
    }));
  }

  function handleNarrationTextChange(text: string) {
    updatePanel(panel.id, (p) => ({
      ...p,
      narration: text || null,
      narrationBubble: text && !p.narrationBubble ? getDefaultNarrationBubble() : p.narrationBubble,
    }));
  }

  function handleNarrationFontSizeChange(fontSize: number) {
    updatePanel(panel.id, (p) =>
      p.narrationBubble ? { ...p, narrationBubble: { ...p.narrationBubble, font_size: fontSize } } : p
    );
  }

  function handleNarrationSizeChange(field: "width" | "height", value: number) {
    updatePanel(panel.id, (p) =>
      p.narrationBubble ? { ...p, narrationBubble: clampBubbleRect({ ...p.narrationBubble, [field]: value }) } : p
    );
  }

  function handleResetLayout() {
    updatePanel(panel.id, (p) => ({
      ...p,
      dialogue: p.dialogue.map((d, i) => ({ ...d, bubble: getDefaultBubbleForIndex(i) })),
      narrationBubble: p.narration ? getDefaultNarrationBubble() : null,
      coverTitleBubble: p.panelType === "cover" && p.coverTitle ? getDefaultCoverTitleBubble() : p.coverTitleBubble,
    }));
  }

  function handleCoverTitleChange(text: string) {
    updatePanel(panel.id, (p) => ({
      ...p,
      coverTitle: text || null,
      coverTitleBubble: text && !p.coverTitleBubble ? getDefaultCoverTitleBubble() : p.coverTitleBubble,
    }));
  }

  function handleCoverSubtitleChange(text: string) {
    updatePanel(panel.id, (p) => ({ ...p, coverSubtitle: text || null }));
  }

  function handleCoverFontSizeChange(fontSize: number) {
    updatePanel(panel.id, (p) =>
      p.coverTitleBubble ? { ...p, coverTitleBubble: { ...p.coverTitleBubble, font_size: fontSize } } : p
    );
  }

  function handleCoverSizeChange(field: "width" | "height", value: number) {
    updatePanel(panel.id, (p) =>
      p.coverTitleBubble ? { ...p, coverTitleBubble: clampBubbleRect({ ...p.coverTitleBubble, [field]: value }) } : p
    );
  }

  // STEP 7 §4, §18 — 드래그(마우스/터치 공통, Pointer Events)로 말풍선을
  // 옮긴다. 좌표는 오버레이 컨테이너의 실제 렌더 크기(getBoundingClientRect)
  // 기준 비율로 변환하므로 캔버스 내부 해상도와 무관하게 동작하고,
  // 매 이동마다 clampBubbleRect로 경계를 강제한다.
  function handlePointerDown(e: React.PointerEvent, target: Selection) {
    if (!target) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelection(target);

    let startX = 0;
    let startY = 0;
    if (target.kind === "dialogue") {
      const item = panel.dialogue.find((d) => d.id === target.id);
      if (item?.bubble) {
        startX = item.bubble.x;
        startY = item.bubble.y;
      }
    } else if (target.kind === "narration" && panel.narrationBubble) {
      startX = panel.narrationBubble.x;
      startY = panel.narrationBubble.y;
    } else if (target.kind === "cover" && panel.coverTitleBubble) {
      startX = panel.coverTitleBubble.x;
      startY = panel.coverTitleBubble.y;
    }

    dragState.current = { target, startClientX: e.clientX, startClientY: e.clientY, startX, startY };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragState.current;
    if (!drag || !overlayRef.current) return;
    const fg = foregroundRect ?? fallbackForeground(dims.width, dims.height);
    const rect = overlayRef.current.getBoundingClientRect();
    // rect(오버레이)는 canvas 전체(1080x1350 등)에 대응하므로, 여기서 나오는 델타는
    // "canvas 기준" 비율이다. bubble 좌표는 foreground(원본 이미지) 기준 0~1이므로,
    // canvas 폭/높이와 foreground의 실제 렌더 폭/높이 비율만큼 보정해서 변환한다.
    const dxCanvasFrac = (e.clientX - drag.startClientX) / rect.width;
    const dyCanvasFrac = (e.clientY - drag.startClientY) / rect.height;
    const dx = dxCanvasFrac * (dims.width / fg.drawWidth);
    const dy = dyCanvasFrac * (dims.height / fg.drawHeight);
    const nextX = drag.startX + dx;
    const nextY = drag.startY + dy;

    if (drag.target?.kind === "dialogue") {
      const targetId = drag.target.id;
      updatePanel(panel.id, (p) => ({
        ...p,
        dialogue: p.dialogue.map((d) =>
          d.id === targetId && d.bubble ? { ...d, bubble: clampBubbleRect({ ...d.bubble, x: nextX, y: nextY }) } : d
        ),
      }));
    } else if (drag.target?.kind === "narration") {
      updatePanel(panel.id, (p) =>
        p.narrationBubble ? { ...p, narrationBubble: clampBubbleRect({ ...p.narrationBubble, x: nextX, y: nextY }) } : p
      );
    } else if (drag.target?.kind === "cover") {
      updatePanel(panel.id, (p) =>
        p.coverTitleBubble ? { ...p, coverTitleBubble: clampBubbleRect({ ...p.coverTitleBubble, x: nextX, y: nextY }) } : p
      );
    }
  }

  function handlePointerUp() {
    dragState.current = null;
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const result =
        panel.panelType === "cover"
          ? await saveCoverLayoutAction(panel.id, panel.coverTitle, panel.coverSubtitle, panel.coverTitleBubble)
          : await saveBubbleLayoutAction(panel.id, panel.dialogue, panel.narration, panel.narrationBubble);
      if (result.ok) {
        setDirty((prev) => ({ ...prev, [panel.id]: false }));
        setMessage("저장되었습니다.");
      } else {
        setMessage(result.message ?? "저장에 실패했습니다.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleFinalRender() {
    if (!canvasRef.current) return;
    setRendering(true);
    setMessage(null);
    try {
      // 저장하지 않은 편집 내용도 최종 이미지에는 즉시 반영되도록, 먼저
      // 최신 상태로 캔버스를 다시 그린 뒤 그 결과를 그대로 내보낸다.
      const blob = await canvasToPngBlob(canvasRef.current);
      const file = new File([blob], "final.png", { type: "image/png" });
      const result = await saveFinalRenderAction(panel.id, file);
      if (result.ok && result.signedUrl) {
        setFinalPreviewUrl(result.signedUrl);
        setMessage("최종 이미지를 만들었습니다.");
      } else {
        setMessage(result.message ?? "최종 이미지 생성에 실패했습니다.");
      }
    } finally {
      setRendering(false);
    }
  }

  if (!panel) return <p>편집할 컷이 없습니다.</p>;

  return (
    <div>
      <div className="tabbar" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {panels.map((p, i) => (
          <button
            key={p.id}
            type="button"
            className={`btn ${i === currentIndex ? "btn-primary" : ""}`}
            onClick={() => goToPanel(i)}
          >
            {p.panelNumber}컷{dirty[p.id] ? " *" : ""}
          </button>
        ))}
      </div>

      {message && <p className="hint">{message}</p>}

      <div
        ref={overlayRef}
        style={{ position: "relative", width: "100%", touchAction: "none" }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <canvas ref={canvasRef} style={{ width: "100%", height: "auto", display: "block", borderRadius: 12 }} />

        {(() => {
          const fg = foregroundRect ?? fallbackForeground(dims.width, dims.height);
          // bubble은 foreground(원본 이미지) 기준 0~1이므로, overlay(=canvas 전체) 기준 %로
          // 변환하려면 offset/drawWidth를 거쳐 canvas 전체 크기로 다시 나눠야 한다.
          const toCanvasPct = (rect: { x: number; y: number; width: number; height: number }) => ({
            left: ((fg.offsetX + rect.x * fg.drawWidth) / dims.width) * 100,
            top: ((fg.offsetY + rect.y * fg.drawHeight) / dims.height) * 100,
            width: ((rect.width * fg.drawWidth) / dims.width) * 100,
            height: ((rect.height * fg.drawHeight) / dims.height) * 100,
          });

          return (
            <>
              {panel.dialogue.map((item) => {
                if (!item.bubble) return null;
                const pct = toCanvasPct(item.bubble);
                return (
                  <div
                    key={item.id}
                    onPointerDown={(e) => handlePointerDown(e, { kind: "dialogue", id: item.id })}
                    style={{
                      position: "absolute",
                      left: `${pct.left}%`,
                      top: `${pct.top}%`,
                      width: `${pct.width}%`,
                      height: `${pct.height}%`,
                      border:
                        selection?.kind === "dialogue" && selection.id === item.id
                          ? "2px solid #2563eb"
                          : "2px dashed rgba(37,99,235,0.5)",
                      cursor: "grab",
                      boxSizing: "border-box",
                    }}
                  />
                );
              })}

              {panel.narrationBubble &&
                (() => {
                  const pct = toCanvasPct(panel.narrationBubble);
                  return (
                    <div
                      onPointerDown={(e) => handlePointerDown(e, { kind: "narration" })}
                      style={{
                        position: "absolute",
                        left: `${pct.left}%`,
                        top: `${pct.top}%`,
                        width: `${pct.width}%`,
                        height: `${pct.height}%`,
                        border: selection?.kind === "narration" ? "2px solid #f59e0b" : "2px dashed rgba(245,158,11,0.5)",
                        cursor: "grab",
                        boxSizing: "border-box",
                      }}
                    />
                  );
                })()}

              {panel.panelType === "cover" &&
                panel.coverTitleBubble &&
                (() => {
                  const pct = toCanvasPct(panel.coverTitleBubble);
                  return (
                    <div
                      onPointerDown={(e) => handlePointerDown(e, { kind: "cover" })}
                      style={{
                        position: "absolute",
                        left: `${pct.left}%`,
                        top: `${pct.top}%`,
                        width: `${pct.width}%`,
                        height: `${pct.height}%`,
                        border: selection?.kind === "cover" ? "2px solid #16a34a" : "2px dashed rgba(22,163,74,0.5)",
                        cursor: "grab",
                        boxSizing: "border-box",
                      }}
                    />
                  );
                })()}
            </>
          );
        })()}
      </div>

      <div className="form-actions" style={{ marginTop: 12 }}>
        <button type="button" className="btn" onClick={() => goToPanel(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0}>
          이전 컷
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => goToPanel(Math.min(panels.length - 1, currentIndex + 1))}
          disabled={currentIndex === panels.length - 1}
        >
          다음 컷
        </button>
        <button type="button" className="btn" onClick={handleResetLayout}>
          기본 배치로 되돌리기
        </button>
      </div>

      {panel.panelType === "cover" ? (
        <div className="card" onClick={() => panel.coverTitleBubble && setSelection({ kind: "cover" })}>
          <h3 style={{ fontSize: 14 }}>표지 제목/부제</h3>
          <div className="field">
            <label>제목</label>
            <textarea
              className="textarea"
              value={panel.coverTitle ?? ""}
              onChange={(e) => handleCoverTitleChange(e.target.value)}
              rows={1}
            />
          </div>
          <div className="field">
            <label>부제</label>
            <textarea
              className="textarea"
              value={panel.coverSubtitle ?? ""}
              onChange={(e) => handleCoverSubtitleChange(e.target.value)}
              rows={1}
            />
          </div>
          {panel.coverTitleBubble && (
            <>
              <div className="field">
                <label>제목 글자 크기 ({panel.coverTitleBubble.font_size ?? 44}px, 부제는 자동으로 더 작게 표시됩니다)</label>
                <input
                  type="range"
                  min={20}
                  max={80}
                  value={panel.coverTitleBubble.font_size ?? 44}
                  onChange={(e) => handleCoverFontSizeChange(Number(e.target.value))}
                />
              </div>
              <div className="field">
                <label>너비 ({Math.round(panel.coverTitleBubble.width * 100)}%)</label>
                <input
                  type="range"
                  min={30}
                  max={100}
                  value={Math.round(panel.coverTitleBubble.width * 100)}
                  onChange={(e) => handleCoverSizeChange("width", Number(e.target.value) / 100)}
                />
              </div>
              <div className="field">
                <label>높이 ({Math.round(panel.coverTitleBubble.height * 100)}%)</label>
                <input
                  type="range"
                  min={8}
                  max={60}
                  value={Math.round(panel.coverTitleBubble.height * 100)}
                  onChange={(e) => handleCoverSizeChange("height", Number(e.target.value) / 100)}
                />
              </div>
            </>
          )}
        </div>
      ) : (
        <>
      <h3 style={{ fontSize: 14 }}>대사</h3>
      {panel.dialogue.map((item) => (
        <div
          key={item.id}
          className="card"
          onClick={() => setSelection({ kind: "dialogue", id: item.id })}
          style={{ cursor: "pointer", outline: selection?.kind === "dialogue" && selection.id === item.id ? "2px solid #2563eb" : "none" }}
        >
          <div className="field">
            <label>대사</label>
            <textarea
              className="textarea"
              value={item.text}
              onChange={(e) => handleTextChange(item.id, e.target.value)}
              rows={2}
            />
          </div>
          <div className="field">
            <label>캐릭터</label>
            <select
              className="input"
              value={item.character_id}
              onChange={(e) => handleCharacterChange(item.id, e.target.value)}
            >
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>말풍선 스타일</label>
            <select
              className="input"
              value={item.bubble?.style ?? "round"}
              onChange={(e) => handleStyleChange(item.id, e.target.value as ToonBubbleStyle)}
            >
              {(Object.keys(BUBBLE_STYLE_LABELS) as ToonBubbleStyle[]).map((s) => (
                <option key={s} value={s}>
                  {BUBBLE_STYLE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          {item.bubble && (
            <>
              <div className="field">
                <label>글자 크기 ({item.bubble.font_size ?? 28}px)</label>
                <input
                  type="range"
                  min={12}
                  max={64}
                  value={item.bubble.font_size ?? 28}
                  onChange={(e) => handleFontSizeChange(item.id, Number(e.target.value))}
                />
              </div>
              <div className="field">
                <label>너비 ({Math.round(item.bubble.width * 100)}%)</label>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={Math.round(item.bubble.width * 100)}
                  onChange={(e) => handleSizeChange(item.id, "width", Number(e.target.value) / 100)}
                />
              </div>
              <div className="field">
                <label>높이 ({Math.round(item.bubble.height * 100)}%)</label>
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={Math.round(item.bubble.height * 100)}
                  onChange={(e) => handleSizeChange(item.id, "height", Number(e.target.value) / 100)}
                />
              </div>
            </>
          )}
        </div>
      ))}

      <h3 style={{ fontSize: 14 }}>내레이션</h3>
      <div className="card" onClick={() => panel.narrationBubble && setSelection({ kind: "narration" })}>
        <div className="field">
          <label>내레이션 문구</label>
          <textarea
            className="textarea"
            value={panel.narration ?? ""}
            onChange={(e) => handleNarrationTextChange(e.target.value)}
            rows={2}
          />
        </div>
        {panel.narrationBubble && (
          <>
            <div className="field">
              <label>글자 크기 ({panel.narrationBubble.font_size ?? 24}px)</label>
              <input
                type="range"
                min={12}
                max={64}
                value={panel.narrationBubble.font_size ?? 24}
                onChange={(e) => handleNarrationFontSizeChange(Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label>너비 ({Math.round(panel.narrationBubble.width * 100)}%)</label>
              <input
                type="range"
                min={10}
                max={100}
                value={Math.round(panel.narrationBubble.width * 100)}
                onChange={(e) => handleNarrationSizeChange("width", Number(e.target.value) / 100)}
              />
            </div>
          </>
        )}
      </div>
        </>
      )}

      <div className="form-actions" style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "저장 중..." : "저장"}
        </button>
        <button type="button" className="btn btn-primary" onClick={handleFinalRender} disabled={rendering}>
          {rendering ? "만드는 중..." : "최종 이미지 만들기"}
        </button>
      </div>

      {finalPreviewUrl && (
        <div className="card">
          <p className="hint">최종 이미지 ({dims.width}x{dims.height})</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={finalPreviewUrl} alt="최종 이미지" style={{ width: "100%", borderRadius: 12 }} />
        </div>
      )}
    </div>
  );
}
