"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { editablePanel, changedPanels, parseDraft, restoreDraft, resizeRect, type EditorDraft } from "../../../../../lib/editor/draft";
import type { EditorPanelData } from "../../../../../lib/projects/editor";
import { getPanelEditorData, saveBubbleLayoutAction, saveCoverLayoutAction, saveFinalRenderAction } from "../../../../../lib/projects/editor";
import DialogueImportPanel from "./DialogueImportPanel";
import {
  AUTO_FIT_MAX_HEIGHT,
  AUTO_FIT_MAX_WIDTH,
  AUTO_FIT_MIN_HEIGHT,
  AUTO_FIT_MIN_WIDTH,
  AUTO_FIT_WRAP_WIDTH_RATIO,
  DEFAULT_BUBBLE_FONT_SIZE,
  clampBubbleRect,
  computeAutoFitBubbleSize,
  getDefaultBubbleForIndex,
  getDefaultCoverTitleBubble,
  getDefaultNarrationBubble,
} from "../../../../../lib/editor/bubbleLayout";
import {
  FONT_FAMILY,
  canvasToPngBlob,
  fetchAsObjectUrl,
  renderPanelToCanvas,
  type RenderedForeground,
} from "../../../../../lib/editor/renderPanel";
import { scaleFontSizeToForeground } from "../../../../../lib/editor/containFit";
import { renderPanelsInOrder } from "../../../../../lib/editor/batchRender";
import { smartLayoutAll, type SmartResult } from "../../../../../lib/editor/smartLayout";
import { applySmartLayoutAction } from "../../../../../lib/projects/smartLayout";
import { applySmartV2Action, prepareSmartV2PreviewAction, visualCacheSummaryAction, type PreviewEntry } from "../../../../../lib/projects/smartLayoutV2";
import { canAutomaticallyArrange, panelLayoutSource } from "../../../../../lib/editor/layoutProvenance";
import { getFinalImageDimensions } from "../../../../../src/providers/finalImageConfig";
import type { ProjectCharacterContext } from "../../../../../lib/projects/service";
import type { ToonBubbleStyle, ToonBubbleTailDirection, ToonNarrationPreset } from "../../../../../src/db/types";

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
  normal: "일반",
  shout: "외침",
  whisper: "속삭임",
  soft: "감성",
  text_only: "글자만",
};

const TAIL_DIRECTION_LABELS: Record<Exclude<ToonBubbleTailDirection, "none">, string> = {
  "bottom-left": "왼쪽 아래",
  "bottom-right": "오른쪽 아래",
  "top-left": "왼쪽 위",
  "top-right": "오른쪽 위",
  left: "왼쪽",
  right: "오른쪽",
};

export default function EditorClient({
  projectId,
  initialPanels,
  characters,
  initialPanelIndex = 0,
  externalProject = false,
}: {
  projectId: string;
  initialPanels: EditorPanelData[];
  characters: ProjectCharacterContext[];
  initialPanelIndex?: number;
  externalProject?: boolean;
}) {
  const savedPanels = useRef(initialPanels);
  const [draftReady, setDraftReady] = useState(false);
  const [recovery, setRecovery] = useState<EditorDraft | null>(null);
  const [draftNotice, setDraftNotice] = useState("");
  const [showGuides, setShowGuides] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [historyVersion, setHistoryVersion] = useState(0);
  const history = useRef<{past:EditorPanelData[][];future:EditorPanelData[][];last:number}>({past:[],future:[],last:0});
  const [panels, setPanels] = useState<EditorPanelData[]>(initialPanels);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [currentIndex, setCurrentIndex] = useState(
    initialPanelIndex >= 0 && initialPanelIndex < initialPanels.length ? initialPanelIndex : 0
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [hideText, setHideText] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [batchRendering, setBatchRendering] = useState(false);
  const [batchFailed, setBatchFailed] = useState<number[]>([]);
  const [batchCompleted, setBatchCompleted] = useState<Set<string>>(() => new Set(initialPanels.filter((p) => p.hasFinalImage).map((p) => p.id)));
  const batchLock = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [finalPreviewUrl, setFinalPreviewUrl] = useState<string | null>(null);
  const [foregroundRect, setForegroundRect] = useState<RenderedForeground | null>(null);
  const [smartPreview, setSmartPreview] = useState<{ results: SmartResult[]; overwrite: boolean; targetId: string | null } | null>(null);
  const [smartOverwrite, setSmartOverwrite] = useState(false);
  const [smartSaving, setSmartSaving] = useState(false);
  const [v2Preview, setV2Preview] = useState<{ entries: PreviewEntry[]; overwrite: boolean; targetId: string | null } | null>(null);
  const [v2Overwrite, setV2Overwrite] = useState(false);
  const [v2Progress, setV2Progress] = useState<string | null>(null);
  const [cacheSummary, setCacheSummary] = useState<{ cached: number; needed: number } | null>(null);

  const backupInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const objectUrlCache = useRef<Map<string, string>>(new Map());
  const dragState = useRef<{
    target: Selection;
    resize: boolean;
    startWidth: number;
    startHeight: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const v2Current = v2Preview?.entries[currentIndex]?.result;
  const panel = v2Current?.status === "PASS" ? { ...panels[currentIndex], ...v2Current.panel }
    : smartPreview?.results[currentIndex]?.status === "PASS" ? { ...panels[currentIndex], ...smartPreview.results[currentIndex].panel } : panels[currentIndex];
  const dims = useMemo(() => getFinalImageDimensions(), []);

  const draftKey = `crevena:editor:v1:${projectId}`;
  useEffect(() => {
    try { setRecovery(parseDraft(sessionStorage.getItem(draftKey),projectId)); }
    catch { setDraftNotice("브라우저 임시 보관을 사용할 수 없습니다. 자주 저장해주세요."); }
    setDraftReady(true);
  }, [draftKey,projectId]);
  useEffect(() => {
    if (!draftReady || recovery) return;
    try {
      const edited=panels.filter(p=>dirty[p.id]).map(editablePanel);
      if (edited.length) { sessionStorage.setItem(draftKey,JSON.stringify({version:1,projectId,savedAt:Date.now(),panels:edited}));setDraftNotice("이 탭에 임시 보관됨 · 서버 저장은 저장 버튼을 눌러주세요."); }
      else {sessionStorage.removeItem(draftKey);setDraftNotice("");}
    } catch {setDraftNotice("임시 보관 실패 · 변경사항을 서버에 저장해주세요.");}
  }, [panels,dirty,draftReady,recovery,draftKey,projectId]);
  useEffect(() => {
    const warn=(event:BeforeUnloadEvent)=>{if(Object.values(dirty).some(Boolean)){event.preventDefault();event.returnValue="";}};
    window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);
  },[dirty]);
  function downloadLayoutBackup(){
    const data={version:1,projectId,savedAt:Date.now(),panels:panels.map(editablePanel)};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
    const link=document.createElement("a");link.href=url;link.download=`crevena-dialogue-layout-${projectId}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function importLayoutBackup(file:File|undefined){
    if(!file)return;
    if(file.size>2_000_000){setMessage("대사·배치 백업은 2MB 이내여야 합니다.");return;}
    const loaded=parseDraft(await file.text(),projectId);
    if(!loaded || !loaded.panels.every(p=>panels.some(current=>current.id===p.id))){setMessage("이 프로젝트의 대사·배치 백업 파일이 아닙니다. 이미지 ZIP은 이미지 가져오기에서 선택해주세요.");return;}
    setRecovery(loaded);
  }
  function checkpoint(force=false) {
    const now=Date.now();
    if(force || now-history.current.last>600){history.current.past.push(panels);history.current.past=history.current.past.slice(-40);}
    history.current.future=[];history.current.last=now;setHistoryVersion(v=>v+1);
  }
  function applyLocalPanels(next:EditorPanelData[]){
    const changed=changedPanels(next,savedPanels.current);
    setPanels(next);setDirty(changed);
    setBatchCompleted(new Set(next.filter(p=>!changed[p.id]&&p.hasFinalImage).map(p=>p.id)));
  }
  function travelHistory(redo:boolean) {
    const from=redo?history.current.future:history.current.past;
    const target=from.pop();if(!target)return;
    (redo?history.current.past:history.current.future).push(panels);
    applyLocalPanels(target);history.current.last=0;setSmartPreview(null);setV2Preview(null);setSelection(null);setHistoryVersion(v=>v+1);
  }
  function updatePanel(panelId: string, updater: (p: EditorPanelData) => EditorPanelData) {
    if (!dragState.current) checkpoint();
    setSmartPreview(null);
    setV2Preview(null);
    setPanels((prev) => prev.map((p) => (p.id === panelId ? updater(p) : p)));
    setDirty((prev) => ({ ...prev, [panelId]: true }));
    setBatchCompleted((prev) => { const next = new Set(prev); next.delete(panelId); return next; });
  }

  // STEP 7 §8 — 미리보기용 canvas를 최종 해상도로 그리고
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
      const previewCanvas = document.createElement("canvas");
      const foreground = await renderPanelToCanvas(previewCanvas, {
        characterNames: Object.fromEntries(characters.map((c) => [c.id, c.display_name])),
        hideText,
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
      if (!cancelled && canvasRef.current) {
        canvasRef.current.width = dims.width;
        canvasRef.current.height = dims.height;
        canvasRef.current.getContext("2d")?.drawImage(previewCanvas, 0, 0);
        setForegroundRect(foreground);
      }
    }
    setPreviewError(null);
    draw().catch((error) => { if (!cancelled) setPreviewError(error instanceof Error ? error.message : "미리보기를 만들지 못했습니다."); });
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
    hideText,
  ]);

  function goToPanel(index: number) {
    if (index === currentIndex) return;
    if(saving || rendering || batchRendering)return;
    history.current.last=0;
    setSelection(null);
    setFinalPreviewUrl(null);
    setMessage(null);
    setForegroundRect(null);
    setCurrentIndex(index);
  }

  function previewSmart(single: boolean, overwrite = smartOverwrite, targetId = single ? panels[currentIndex].id : null) {
    if (Object.values(dirty).some(Boolean)) { setMessage("자동 배치 전에 편집 중인 내용을 저장해주세요."); return; }
    const results = smartLayoutAll(panels.map((p) => ({ ...p,
      hasStoredLayout: !canAutomaticallyArrange(panelLayoutSource(p)),
    })), overwrite)
      .map((r, i) => targetId && panels[i].id !== targetId ? { status: "SKIPPED_MANUAL" as const, panel: panels[i], reason: "이번 적용 대상 아님" } : r);
    setSmartPreview({ results, overwrite, targetId });
    setV2Preview(null);
    setMessage(null);
  }

  async function previewV2(targetId: string | null = null, overwrite = v2Overwrite) {
    if (Object.values(dirty).some(Boolean)) { setMessage("자동 배치 전에 편집 중인 내용을 저장해주세요."); return; }
    setSmartPreview(null); setV2Preview(null); setMessage(null);
    setV2Progress("분석 준비");
    try {
      const summary = await visualCacheSummaryAction(projectId, overwrite, targetId);
      setCacheSummary(summary.ok ? { cached: summary.cached ?? 0, needed: summary.needed ?? 0 } : null);
      const entries: PreviewEntry[] = [];
      if (targetId) {
        const preview = await prepareSmartV2PreviewAction(projectId, overwrite, targetId);
        if (!preview.ok || !preview.entries) throw Error(preview.message ?? "미리보기를 준비하지 못했습니다.");
        entries.push(...preview.entries);
      } else for (const [index, candidate] of panels.entries()) {
        setV2Progress(`이미지 분석 및 배치 ${index + 1}/${panels.length}`);
        const preview = await prepareSmartV2PreviewAction(projectId, overwrite, candidate.id);
        if (!preview.ok || !preview.entries) throw Error(preview.message ?? "미리보기를 준비하지 못했습니다.");
        const entry = preview.entries.find((value) => value.target.id === candidate.id);
        if (!entry) throw Error("컷을 확인하지 못했습니다.");
        entries.push(entry);
      }
      setV2Progress("자동 배치 계산 중");
      setV2Preview({ entries, overwrite, targetId });
      setV2Progress("미리보기 준비 완료");
    } catch (error) { setV2Progress(null); setMessage(error instanceof Error ? error.message : "미리보기 준비 실패"); }
  }

  async function applyV2() {
    if (!v2Preview || smartSaving) return;
    setSmartSaving(true);
    try {
      const targets = v2Preview.entries.filter((entry) => entry.result.status === "PASS").map((entry) => entry.target);
      const result = await applySmartV2Action(projectId, targets, v2Preview.overwrite);
      if (!result.ok) { setMessage(result.message); return; }
      const fresh = await getPanelEditorData(projectId);
      if (!fresh.ok) { setMessage("적용 후 편집기 새로고침에 실패했습니다."); return; }
      setPanels(fresh.panels); setV2Preview(null); setMessage(result.message);
      setBatchCompleted((previous) => { const next = new Set(previous); targets.forEach((target) => next.delete(target.id)); return next; });
    } finally { setSmartSaving(false); }
  }

  async function applySmart() {
    if (!smartPreview || smartSaving) return;
    const targets = panels.filter((p) => !smartPreview.targetId || p.id === smartPreview.targetId).map((p) => ({ id: p.id, updatedAt: p.updatedAt }));
    setSmartSaving(true);
    try {
      const result = await applySmartLayoutAction(projectId, targets, smartPreview.overwrite);
      if (!result.ok) { setMessage(result.message); setSmartPreview(null); return; }
      const fresh = await getPanelEditorData(projectId);
      if (!fresh.ok) { setMessage("적용은 완료되었으나 새로고침하지 못했습니다. 페이지를 다시 열어주세요."); setSmartPreview(null); return; }
      setPanels(fresh.panels);
      setBatchCompleted((previous) => { const next = new Set(previous); for (const target of targets) next.delete(target.id); return next; });
      setSmartPreview(null);
      setMessage(result.message);
    } catch { setSmartPreview(null); setMessage("저장 결과를 확인하지 못했습니다. 페이지를 다시 열어 확인해주세요."); }
    finally { setSmartSaving(false); }
  }

  function handleTextChange(itemId: string, text: string) {
    updatePanel(panel.id, (p) => ({
      ...p,
      dialogue: p.dialogue.map((d) => (d.id === itemId ? { ...d, text } : d)),
    }));
  }

  function addDialogue() {
    if (!characters[0]) { setMessage("대사를 넣으려면 캐릭터를 먼저 등록해주세요."); return; }
    updatePanel(panel.id, (p) => ({ ...p, dialogue: [...p.dialogue, {
      id: crypto.randomUUID(), character_id: characters[0].id, text: "대사를 입력하세요",
      bubble_type: "speech", bubble: getDefaultBubbleForIndex(p.dialogue.length),
    }] }));
  }

  function removeDialogue(id: string) {
    updatePanel(panel.id, (p) => ({ ...p, dialogue: p.dialogue.filter((item) => item.id !== id) }));
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

  function handleBubbleOpacityChange(itemId: string, opacity: number) {
    updatePanel(panel.id, (p) => ({ ...p, dialogue: p.dialogue.map((d) => d.id === itemId && d.bubble ? { ...d, bubble: { ...d.bubble, opacity } } : d) }));
  }

  function handleSizeChange(itemId: string, field: "width" | "height", value: number) {
    updatePanel(panel.id, (p) => ({
      ...p,
      dialogue: p.dialogue.map((d) =>
        d.id === itemId && d.bubble ? { ...d, bubble: clampBubbleRect({ ...d.bubble, [field]: value }) } : d
      ),
    }));
  }

  // STEP — "내용에 맞게" Auto Fit. 사용자가 버튼을 누른 시점에만 실행되며,
  // x/y는 그대로 두고 width/height만 실제 렌더러와 동일한 font/wrap 규칙으로
  // 다시 계산한다. 페이지 로드나 다른 조작만으로는 절대 호출되지 않는다.
  function handleAutoFit(itemId: string) {
    const item = panel.dialogue.find((d) => d.id === itemId);
    const ctx = canvasRef.current?.getContext("2d");
    if (!item?.bubble || !ctx) return;

    const fg = foregroundRect ?? fallbackForeground(dims.width, dims.height);
    const fontSizePx = scaleFontSizeToForeground(item.bubble.font_size ?? DEFAULT_BUBBLE_FONT_SIZE, fg.drawWidth);
    ctx.font = `${fontSizePx}px ${FONT_FAMILY}`;

    const { widthPx, heightPx } = computeAutoFitBubbleSize({
      text: item.text,
      fontSizePx,
      measureWidth: (t) => ctx.measureText(t).width,
      wrapWidthPx: fg.drawWidth * AUTO_FIT_WRAP_WIDTH_RATIO,
      minWidthPx: AUTO_FIT_MIN_WIDTH * fg.drawWidth,
      minHeightPx: AUTO_FIT_MIN_HEIGHT * fg.drawHeight,
      maxWidthPx: AUTO_FIT_MAX_WIDTH * fg.drawWidth,
      maxHeightPx: AUTO_FIT_MAX_HEIGHT * fg.drawHeight,
    });

    updatePanel(panel.id, (p) => ({
      ...p,
      dialogue: p.dialogue.map((d) =>
        d.id === itemId && d.bubble
          ? { ...d, bubble: clampBubbleRect({ ...d.bubble, width: widthPx / fg.drawWidth, height: heightPx / fg.drawHeight }) }
          : d
      ),
    }));
  }

  function handleTailEnabledChange(itemId: string, enabled: boolean) {
    updatePanel(panel.id, (p) => ({
      ...p,
      dialogue: p.dialogue.map((d) =>
        d.id === itemId && d.bubble
          ? {
              ...d,
              bubble: {
                ...d.bubble,
                tail_enabled: enabled,
                // 꺼져 있다가 처음 켤 때 방향이 "none"이면 실제로 보이는 방향으로 바꿔준다.
                tail_direction: enabled && d.bubble.tail_direction === "none" ? "bottom-left" : d.bubble.tail_direction,
              },
            }
          : d
      ),
    }));
  }

  function handleTailDirectionChange(itemId: string, direction: ToonBubbleTailDirection) {
    updatePanel(panel.id, (p) => ({
      ...p,
      dialogue: p.dialogue.map((d) =>
        d.id === itemId && d.bubble ? { ...d, bubble: { ...d.bubble, tail_direction: direction } } : d
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

  function handleNarrationPresetChange(preset: ToonNarrationPreset) {
    updatePanel(panel.id, (p) => p.narrationBubble ? { ...p, narrationBubble: { ...p.narrationBubble, preset } } : p);
  }

  function handleNarrationOpacityChange(opacity: number) {
    updatePanel(panel.id, (p) => p.narrationBubble ? { ...p, narrationBubble: { ...p.narrationBubble, opacity } } : p);
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

  function handleCoverSubtitleLayoutChange(field: "subtitle_font_size" | "subtitle_line_height", value: number) {
    updatePanel(panel.id, (p) =>
      p.coverTitleBubble ? { ...p, coverTitleBubble: { ...p.coverTitleBubble, [field]: value } } : p
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
  function handlePointerDown(e: React.PointerEvent, target: Selection, resize=false) {
    if (!target || smartPreview || v2Preview || saving || rendering || batchRendering || recovery) return;
    e.stopPropagation();
    checkpoint(true);
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

    const box = target.kind === "dialogue" ? panel.dialogue.find(d=>d.id===target.id)?.bubble : target.kind === "narration" ? panel.narrationBubble : panel.coverTitleBubble;
    if (!box) return;
    dragState.current = { target, resize, startWidth:box.width, startHeight:box.height, startClientX: e.clientX, startClientY: e.clientY, startX, startY };
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
    if (drag.resize) {
      const size=resizeRect({x:drag.startX,y:drag.startY,width:drag.startWidth,height:drag.startHeight},dx,dy);
      updatePanel(panel.id,p=>drag.target?.kind==="dialogue"?{...p,dialogue:p.dialogue.map(d=>d.id===(drag.target as {id:string}).id&&d.bubble?{...d,bubble:{...d.bubble,...size}}:d)}:drag.target?.kind==="narration"&&p.narrationBubble?{...p,narrationBubble:{...p.narrationBubble,...size}}:p.coverTitleBubble?{...p,coverTitleBubble:{...p.coverTitleBubble,...size}}:p);
      return;
    }
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

  function centerSelection(){
    if(!selection)return;
    updatePanel(panel.id,p=>selection.kind==="dialogue"?{...p,dialogue:p.dialogue.map(d=>d.id===selection.id&&d.bubble?{...d,bubble:{...d.bubble,x:(1-d.bubble.width)/2}}:d)}:selection.kind==="narration"&&p.narrationBubble?{...p,narrationBubble:{...p.narrationBubble,x:(1-p.narrationBubble.width)/2}}:selection.kind==="cover"&&p.coverTitleBubble?{...p,coverTitleBubble:{...p.coverTitleBubble,x:(1-p.coverTitleBubble.width)/2}}:p);
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
        const fresh = await getPanelEditorData(projectId);
        const saved=fresh.ok?fresh.panels.find(p=>p.id===panel.id):panel;
        if(saved){savedPanels.current=savedPanels.current.map(p=>p.id===saved.id?saved:p);setPanels(previous=>previous.map(p=>p.id===saved.id?saved:p));}
        history.current={past:[],future:[],last:0};setHistoryVersion(v=>v+1);
        setDirty((prev) => ({ ...prev, [panel.id]: false }));
        setMessage("저장되었습니다.");
      } else {
        setMessage(result.message ?? "저장에 실패했습니다.");
      }
    } catch {
      setMessage("저장 중 연결이 끊겼습니다. 변경사항은 화면에 남아 있으니 다시 저장해주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function handleFinalRender() {
    if (!panel?.rawImageSignedUrl) return;
    if(dirty[panel.id]){setMessage("현재 컷의 변경사항을 먼저 저장해주세요. 저장된 내용과 최종 이미지를 일치시킵니다.");return;}
    setRendering(true);
    setMessage(null);
    try {
      // 저장한 편집 내용을 미리보기 표시 여부와 무관하게 새 캔버스에 그린다.
        let url = objectUrlCache.current.get(panel.id);
        if (!url) {
          url = await fetchAsObjectUrl(panel.rawImageSignedUrl);
          objectUrlCache.current.set(panel.id, url);
        }
        const canvas = document.createElement("canvas");
        await renderPanelToCanvas(canvas, {
          validateText: true,
          characterNames: Object.fromEntries(characters.map((c) => [c.id, c.display_name])),
          imageObjectUrl: url, panelType: panel.panelType, dialogue: panel.dialogue,
          narration: panel.narration, narrationBubble: panel.narrationBubble,
          coverTitle: panel.coverTitle, coverSubtitle: panel.coverSubtitle,
          coverTitleBubble: panel.coverTitleBubble, width: dims.width, height: dims.height,
        });
        const blob = await canvasToPngBlob(canvas);
      const file = new File([blob], "final.png", { type: "image/png" });
      const result = await saveFinalRenderAction(panel.id, file);
      if (result.ok) {
        setFinalPreviewUrl(result.signedUrl ?? null);
        setBatchCompleted((prev) => new Set(prev).add(panel.id));
        setMessage("최종 이미지를 만들었습니다.");
      } else {
        setMessage(result.message ?? "최종 이미지 생성에 실패했습니다.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "최종 이미지 생성에 실패했습니다.");
    } finally {
      setRendering(false);
    }
  }

  async function handleBatchRender() {
    if (batchLock.current) return;
    if (Object.values(dirty).some(Boolean)) {
      setMessage("저장하지 않은 내용이 있습니다. 각 컷을 저장한 뒤 전체 이미지를 만드세요.");
      return;
    }
    batchLock.current = true;
    setBatchRendering(true);
    setBatchFailed([]);
    setMessage(null);
    try {
      const result = await renderPanelsInOrder(panels, batchCompleted, async (target) => {
        if (!target.rawImageSignedUrl) throw new Error("원본 이미지가 없습니다.");
        let url = objectUrlCache.current.get(target.id);
        if (!url) { url = await fetchAsObjectUrl(target.rawImageSignedUrl); objectUrlCache.current.set(target.id, url); }
        const canvas = document.createElement("canvas");
        await renderPanelToCanvas(canvas, {
          validateText: true,
          characterNames: Object.fromEntries(characters.map((c) => [c.id, c.display_name])),
          imageObjectUrl: url, panelType: target.panelType, dialogue: target.dialogue,
          narration: target.narration, narrationBubble: target.narrationBubble,
          coverTitle: target.coverTitle, coverSubtitle: target.coverSubtitle,
          coverTitleBubble: target.coverTitleBubble, width: dims.width, height: dims.height,
        });
        const blob = await canvasToPngBlob(canvas);
        const saved = await saveFinalRenderAction(target.id, new File([blob], "final.png", { type: "image/png" }));
        if (!saved.ok) throw new Error(saved.message ?? "최종 이미지 저장에 실패했습니다.");
      });
      setBatchCompleted(result.completedIds);
      setBatchFailed(result.failed);
      setMessage(result.failed.length
        ? `실패한 컷: ${result.failed.join(", ")}. 성공한 컷은 그대로 유지됩니다.`
        : `${panels.length}장 최종 이미지가 준비되었습니다. Final 페이지에서 ZIP을 받으세요.`);
    } finally { setBatchRendering(false); batchLock.current = false; }
  }

  if (!panel) return <p>편집할 컷이 없습니다.</p>;

  return (
    <div className="editor-workspace" data-history-version={historyVersion}>
      {recovery && <section className="card" role="status"><strong>저장하지 않은 편집 내용이 이 탭에 남아 있습니다.</strong><p>서버 내용과 다를 수 있습니다. 복구 후 비교하고 저장하세요.</p><button className="btn btn-primary" onClick={()=>{checkpoint(true);applyLocalPanels(restoreDraft(panels,recovery));setRecovery(null);}}>임시 작업 복구</button><button className="btn" onClick={()=>{try{sessionStorage.removeItem(draftKey);}catch{}setRecovery(null);}}>서버 내용 유지</button></section>}
      {draftNotice && <p className="hint" role="status">{draftNotice}</p>}
      <div className="form-actions">
        <button className="btn" onClick={downloadLayoutBackup}>대사·배치 백업</button>
        <input type="file" accept=".json" ref={backupInput} hidden onChange={e=>{void importLayoutBackup(e.target.files?.[0]);e.target.value="";}}/>
        <button className="btn" disabled={saving||rendering||batchRendering||!!recovery} onClick={()=>backupInput.current?.click()}>백업 불러오기</button>
        <button className="btn" aria-pressed={showGuides} onClick={()=>setShowGuides(v=>!v)}>정렬 안내선</button>
        <button className="btn" disabled={!selection || saving || rendering || batchRendering || !!smartPreview || !!v2Preview || !!recovery} onClick={centerSelection}>선택한 글 상자 가운데 정렬</button>
        <button className="btn" disabled={!history.current.past.length || saving || rendering || batchRendering || !!recovery} onClick={()=>travelHistory(false)}>실행 취소</button>
        <button className="btn" disabled={!history.current.future.length || saving || rendering || batchRendering || !!recovery} onClick={()=>travelHistory(true)}>다시 실행</button>
        <label>화면 확대 <select className="input" value={zoom} onChange={e=>setZoom(Number(e.target.value))}><option value={1}>100%</option><option value={1.5}>150%</option><option value={2}>200%</option></select></label>
      </div>
      <details className="editor-toolbar">
      <summary>자동 배치 도구</summary>
      <section className="card" style={{ marginBottom: 14, minWidth: 0 }}>
        <div className="form-actions" style={{ flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={() => void previewV2()} disabled={Boolean(v2Progress && v2Progress !== "미리보기 준비 완료") || smartSaving || saving || batchRendering}>전체 자동 배치</button>
          <button type="button" className="btn" onClick={() => void previewV2(panel.id)} disabled={Boolean(v2Progress && v2Progress !== "미리보기 준비 완료") || smartSaving || saving || batchRendering}>이 컷 자동 배치</button>
          <button type="button" className="btn" onClick={() => previewSmart(false)} disabled={smartSaving || saving || batchRendering}>기본 자동 배치</button>
        </div>
        <p className="hint">이미지 영역을 분석하고 안전한 위치를 미리 보여줍니다. 기존에 저장한 배치는 유지됩니다.</p>
        {cacheSummary && <p className="hint">분석 필요 {cacheSummary.needed}장 · 캐시 사용 {cacheSummary.cached}장</p>}
        {v2Progress && <p role="status" className="hint">{v2Progress}</p>}
        {v2Preview && <div aria-label="Smart Layout v2 미리보기" style={{ overflowWrap: "anywhere" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><input type="checkbox" checked={v2Preview.overwrite} onChange={(e) => { setV2Overwrite(e.target.checked); void previewV2(v2Preview.targetId, e.target.checked); }} /> 수동 배치도 다시 자동 배치</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{v2Preview.entries.map((entry, index) => <button type="button" className="btn" key={entry.target.id} onClick={() => goToPanel(index)} style={{ maxWidth: "100%", whiteSpace: "normal", textAlign: "left" }}>
            {panels[index].panelType === "cover" ? "표지" : `Panel ${panels[index].panelNumber - (panels[0].panelType === "cover" ? 1 : 0)}`} — {entry.result.status}<br />
            분석: {entry.analysis} · 배치: {entry.result.source} → {entry.result.status === "PASS" ? "SMART_V2" : "유지"}
            {entry.failureCode && <><br />분석 실패 · {entry.failureCode === "PROVIDER_503" || entry.failureCode === "PROVIDER_TIMEOUT" ? "일시적 AI 오류" : entry.failureCode === "INVALID_STRUCTURED_RESPONSE" || entry.failureCode === "VALIDATION_FAILED" ? "응답 형식 오류" : entry.failureCode === "IMAGE_DOWNLOAD_FAILED" || entry.failureCode === "IMAGE_PREPROCESS_FAILED" ? "이미지 준비 오류" : "분석 처리 오류"}</>}
            {entry.result.avoided.length > 0 && <><br />회피 영역: {entry.result.avoided.join(", ")}</>}
            {entry.result.reason && <><br />{entry.result.reasonCode ?? entry.result.reason}</>}
          </button>)}</div>
          <div className="form-actions" style={{ marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={() => { setV2Preview(null); setV2Progress(null); }} disabled={smartSaving}>취소</button>
            <button type="button" className="btn btn-primary" onClick={() => void applyV2()} disabled={smartSaving || !v2Preview.entries.some((e) => e.result.status === "PASS") || v2Preview.entries.some((e) => e.result.status === "REVIEW_REQUIRED")}>전체 적용</button>
          </div>
        </div>}
        {smartPreview && <div aria-label="자동 배치 미리보기" style={{ overflowWrap: "anywhere" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><input type="checkbox" checked={smartPreview.overwrite} onChange={(e) => { setSmartOverwrite(e.target.checked); previewSmart(Boolean(smartPreview.targetId), e.target.checked, smartPreview.targetId); }} /> 기존 배치도 다시 자동 배치</label>
          <p className="hint">기존 배치는 기본적으로 건너뜁니다. 컷 이름을 눌러 이미지 위 배치를 확인하세요.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{smartPreview.results.map((result, index) => <button type="button" className="btn" key={panels[index].id} onClick={() => goToPanel(index)}>
            {panels[index].panelType === "cover" ? "표지" : `Panel ${panels[index].panelNumber - (panels[0].panelType === "cover" ? 1 : 0)}`} — {result.status}{result.reason ? ` (${result.reason})` : ""}
          </button>)}</div>
          <div className="form-actions" style={{ marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={() => setSmartPreview(null)} disabled={smartSaving}>취소</button>
            <button type="button" className="btn btn-primary" onClick={() => void applySmart()} disabled={smartSaving || !smartPreview.results.some((r) => r.status === "PASS") || smartPreview.results.some((r) => r.status === "REVIEW_REQUIRED")}>{smartSaving ? "적용 중..." : "전체 적용"}</button>
          </div>
        </div>}
      </section>
      </details>
      {externalProject && <DialogueImportPanel projectId={projectId} disabled={Boolean(smartPreview || v2Preview) || saving || rendering || batchRendering || Object.values(dirty).some(Boolean)} onComplete={async (numbers, resultMessage) => {
        const fresh = await getPanelEditorData(projectId);
        if (!fresh.ok) { setMessage("가져오기는 저장되었으나 편집기 새로고침에 실패했습니다. 페이지를 다시 열어주세요."); return; }
        setPanels(fresh.panels);
        setSmartPreview(null);
        setDirty({});
        setBatchCompleted((previous) => {
          const next = new Set(previous);
          for (const updated of fresh.panels) if (numbers.includes(updated.panelNumber)) next.delete(updated.id);
          return next;
        });
        setMessage(resultMessage);
      }} />}
      {externalProject && Object.values(dirty).some(Boolean) && <p className="hint">일괄 가져오기 전에 현재 컷의 변경사항을 저장해주세요.</p>}
      <div className="tabbar" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {panels.map((p, i) => (
          <button
            key={p.id}
            type="button"
            className={`btn ${i === currentIndex ? "btn-primary" : ""}`}
            onClick={() => goToPanel(i)}
          >
            {p.panelType === "cover" ? "표지" : `${p.panelNumber - (panels[0]?.panelType === "cover" ? 1 : 0)}컷`}{dirty[p.id] ? " *" : ""}
          </button>
        ))}
      </div>

      {message && <p className="hint">{message}</p>}

      <div className="editor-stage">
        <div className="form-actions editor-preview-tools">
          <button className="btn" type="button" aria-pressed={hideText} onClick={() => setHideText(!hideText)}>{hideText ? "대사 표시" : "그림만 보기"}</button>
          <span className="hint" role="status">{dirty[panel.id] ? "저장하지 않은 변경사항" : "저장된 상태"}</span>
        </div>
        {foregroundRect?.warnings?.map(warning=><p className="error" role="alert" key={warning}>{warning}</p>)}
        {previewError && <p role="alert" className="error">{previewError}</p>}
      <div className="editor-zoom-scroll">
      <div
        ref={overlayRef}
        style={{ position: "relative", width: `${zoom*100}%`, touchAction: "pan-y" }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <canvas ref={canvasRef} style={{ opacity: previewError ? 0.3 : 1, width: "100%", height: "auto", display: "block", borderRadius: 12 }} />

        {showGuides && foregroundRect && <div aria-hidden="true" className="editor-guides" style={{left:`${foregroundRect.offsetX/dims.width*100}%`,top:`${foregroundRect.offsetY/dims.height*100}%`,width:`${foregroundRect.drawWidth/dims.width*100}%`,height:`${foregroundRect.drawHeight/dims.height*100}%`}}><span/><i/></div>}
        {!hideText && !previewError && (() => {
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
              {(panel.narrationBubble?.composition === "caption" ? [] : panel.dialogue).map((item) => {
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
                      cursor: "grab", touchAction: "none",
                      boxSizing: "border-box",
                    }}
                  >
                    <button type="button" className="resize-handle" aria-label="모서리 드래그로 크기 조절" onPointerDown={(e)=>handlePointerDown(e, { kind: "dialogue", id: item.id }, true)} />
                  </div>
                );
              })}

              {(!panel.narrationBubble?.composition || panel.narrationBubble.composition === "overlay") && panel.narration && panel.narrationBubble &&
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
                        cursor: "grab", touchAction: "none",
                        boxSizing: "border-box",
                      }}
                    >
                    <button type="button" className="resize-handle" aria-label="모서리 드래그로 크기 조절" onPointerDown={(e)=>handlePointerDown(e, { kind: "narration" }, true)} />
                  </div>
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
                        cursor: "grab", touchAction: "none",
                        boxSizing: "border-box",
                      }}
                    >
                    <button type="button" className="resize-handle" aria-label="모서리 드래그로 크기 조절" onPointerDown={(e)=>handlePointerDown(e, { kind: "cover" }, true)} />
                  </div>
                  );
                })()}
            </>
          );
        })()}
      </div>

      </div>
      </div>
      <fieldset className="editor-inspector" disabled={Boolean(smartPreview || v2Preview || saving || rendering || batchRendering || recovery)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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

      {panel.panelType !== "cover" && <section className="card">
        <label htmlFor="text-composition"><strong>그림과 대사 배치</strong></label>
        <select id="text-composition" className="input" value={panel.narrationBubble?.composition ?? "overlay"} onChange={(event) => {
          const composition = event.target.value as "overlay" | "narration-below" | "caption";
          setSelection(null);
          updatePanel(panel.id, (current) => ({ ...current, narrationBubble: { ...(current.narrationBubble ?? getDefaultNarrationBubble()), composition } }));
        }}>
          <option value="overlay">그림 위 말풍선</option>
          <option value="narration-below">내레이션만 그림 아래</option>
          <option value="caption">모든 대사를 그림 아래</option>
        </select>
        <p className="hint">그림 아래 배치는 원본을 자르지 않고 별도 글 영역을 확보합니다. 아래 배치한 글의 위치·크기는 자동으로 맞춥니다. 미리보기 확인 후 저장하세요.</p>
      </section>}
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
                <label>제목 글자 크기 ({panel.coverTitleBubble.font_size ?? 44}px)</label>
                <input
                  type="range"
                  min={20}
                  max={80}
                  value={panel.coverTitleBubble.font_size ?? 44}
                  onChange={(e) => handleCoverFontSizeChange(Number(e.target.value))}
                />
              </div>
              <div className="field">
                <label>부제 글자 크기 ({panel.coverTitleBubble.subtitle_font_size ?? Math.round((panel.coverTitleBubble.font_size ?? 44) * 0.42)}px)</label>
                <input type="range" min={20} max={40} value={panel.coverTitleBubble.subtitle_font_size ?? Math.max(20, Math.round((panel.coverTitleBubble.font_size ?? 44) * 0.42))}
                  onChange={(e) => handleCoverSubtitleLayoutChange("subtitle_font_size", Number(e.target.value))} />
              </div>
              <div className="field">
                <label>부제 줄간격 ({Math.round((panel.coverTitleBubble.subtitle_line_height ?? 1.25) * 100)}%)</label>
                <input type="range" min={100} max={180} value={Math.round((panel.coverTitleBubble.subtitle_line_height ?? 1.25) * 100)}
                  onChange={(e) => handleCoverSubtitleLayoutChange("subtitle_line_height", Number(e.target.value) / 100)} />
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
          <button type="button" className="btn" onClick={() => removeDialogue(item.id)}>대사 삭제</button>
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
          {panel.narrationBubble?.composition !== "caption" && <div className="field">
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
          </div>}
          {item.bubble && panel.narrationBubble?.composition !== "caption" && (
            <>
              <div className="field"><label>말풍선 배경 투명도 ({Math.round((item.bubble.opacity ?? 1) * 100)}%)</label>
                <input type="range" min={0} max={100} value={Math.round((item.bubble.opacity ?? 1) * 100)} onChange={(e) => handleBubbleOpacityChange(item.id, Number(e.target.value) / 100)} />
              </div>
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
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => handleAutoFit(item.id)}>
                  내용에 맞게
                </button>
              </div>
              <div className="field">
                <label>
                  <input
                    type="checkbox"
                    checked={item.bubble.tail_enabled === true}
                    onChange={(e) => handleTailEnabledChange(item.id, e.target.checked)}
                  />{" "}
                  말풍선 꼬리 사용
                </label>
              </div>
              {item.bubble.tail_enabled === true && (
                <div className="field">
                  <label>꼬리 방향</label>
                  <select
                    className="input"
                    value={item.bubble.tail_direction === "none" ? "bottom-left" : item.bubble.tail_direction}
                    onChange={(e) => handleTailDirectionChange(item.id, e.target.value as ToonBubbleTailDirection)}
                  >
                    {(Object.keys(TAIL_DIRECTION_LABELS) as Exclude<ToonBubbleTailDirection, "none">[]).map((dir) => (
                      <option key={dir} value={dir}>
                        {TAIL_DIRECTION_LABELS[dir]}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
        </div>
      ))}

      <button type="button" className="btn" onClick={addDialogue}>대사 추가</button>

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
        {panel.narrationBubble && (!panel.narrationBubble.composition || panel.narrationBubble.composition === "overlay") && (
          <>
            <div className="field"><label>내레이션 배경</label><select className="input" value={panel.narrationBubble.preset ?? "dark"} onChange={(e) => handleNarrationPresetChange(e.target.value as ToonNarrationPreset)}>
              <option value="dark">어둡게</option><option value="light">밝게</option><option value="cream">크림</option><option value="soft">부드럽게</option>
            </select></div>
            <div className="field"><label>배경 투명도 ({Math.round((panel.narrationBubble.opacity ?? 0.72) * 100)}%)</label><input type="range" min={0} max={100} value={Math.round((panel.narrationBubble.opacity ?? 0.72) * 100)} onChange={(e) => handleNarrationOpacityChange(Number(e.target.value) / 100)} /></div>
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
            <div className="field">
              <label>높이 ({Math.round(panel.narrationBubble.height * 100)}%)</label>
              <input type="range" min={5} max={60} value={Math.round(panel.narrationBubble.height * 100)} onChange={(e) => handleNarrationSizeChange("height", Number(e.target.value) / 100)} />
            </div>
          </>
        )}
      </div>
        </>
      )}

      <div className="form-actions" style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || Boolean(previewError)}>
          {saving ? "저장 중..." : "저장"}
        </button>
        <button type="button" className="btn btn-primary" onClick={handleFinalRender} disabled={rendering || batchRendering || Boolean(previewError)}>
          {rendering ? "만드는 중..." : "최종 이미지 만들기"}
        </button>
        <button type="button" className="btn btn-primary" onClick={handleBatchRender} disabled={rendering || batchRendering || Boolean(previewError)}>
          {batchRendering ? "순서대로 만드는 중..." : batchFailed.length ? "실패한 컷만 다시 만들기" : "전체 최종 이미지 만들기"}
        </button>
        {batchCompleted.size === panels.length && <Link className="btn" href={`/toon/projects/${projectId}/final`}>최종 이미지·ZIP 확인</Link>}
      </div>

      {(batchCompleted.size > 0 || batchFailed.length > 0) && (
        <div role="status" className="card" style={{ display: "grid", gap: 4 }}>
          {panels.map((p) => <span key={p.id}>
            {p.panelType === "cover" ? "표지" : String(p.panelNumber - (panels[0]?.panelType === "cover" ? 1 : 0)).padStart(2, "0")}: {batchCompleted.has(p.id) ? "완료" : batchFailed.includes(p.panelNumber) ? "실패" : "대기"}
          </span>)}
        </div>
      )}

      {finalPreviewUrl && (
        <div className="card">
          <p className="hint">최종 이미지 ({dims.width}x{dims.height})</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={finalPreviewUrl} alt="최종 이미지" style={{ width: "100%", borderRadius: 12 }} />
        </div>
      )}
      </fieldset>
    </div>
  );
}
