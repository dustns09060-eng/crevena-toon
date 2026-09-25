"use client";

import { useState } from "react";
import { inspectDialogueImportAction, saveDialogueImportAction } from "../../../../../lib/projects/dialogueImport";
import { readDialogueImportFile } from "../../../../../lib/projects/dialogueImportUtils";

type Inspection = Extract<Awaited<ReturnType<typeof inspectDialogueImportAction>>, { ok: true }>;

export default function DialogueImportPanel({ projectId, onComplete, disabled }: {
  projectId: string;
  onComplete: (numbers: number[], message: string) => Promise<void>;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const conflict = inspection?.conflicts.some((c) => c.dialogue || c.narration || c.coverTitle || c.coverSubtitle) ?? false;

  function changeText(next: string) {
    setText(next); setInspection(null); setConfirmed(false); setError("");
  }

  async function chooseFile(file?: File) {
    if (!file) return;
    changeText("");
    try { changeText(await readDialogueImportFile(file)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "JSON 파일을 읽지 못했습니다."); }
  }

  async function inspect() {
    setBusy(true); setError(""); setInspection(null); setConfirmed(false);
    try {
      const result = await inspectDialogueImportAction(projectId, text);
      if (result.ok) setInspection(result);
      else setError(result.message);
    } catch { setError("검사하지 못했습니다. 다시 시도해주세요."); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!inspection || (conflict && !confirmed)) return;
    setBusy(true); setError("");
    try {
      const result = await saveDialogueImportAction(projectId, text, inspection.fingerprint, confirmed);
      if (!result.ok) { setError(result.message); setInspection(null); return; }
      await onComplete(inspection.document.panels.map((p) => p.panel_number + 1).concat(1), result.message);
      setOpen(false); changeText("");
    } catch { setError("저장 결과를 확인하지 못했습니다. 편집기 상태를 다시 확인해주세요."); }
    finally { setBusy(false); }
  }

  return (
    <section className="card" style={{ marginBottom: 14, minWidth: 0 }}>
      <button type="button" className="btn" onClick={() => { setOpen(!open); setInspection(null); setError(""); }} disabled={busy || disabled}>
        대사/내레이션 일괄 가져오기
      </button>
      {open && <div style={{ marginTop: 14, minWidth: 0 }}>
        <p className="hint">외부 이미지 프로젝트용 JSON입니다. Cover와 가져올 Panel 번호만 적으세요. 빠진 Panel은 그대로 둡니다. 화자는 프로젝트 캐릭터 이름과 정확히 일치해야 합니다.</p>
        <div className="field"><label htmlFor="dialogue-import-file">JSON 파일</label>
          <input id="dialogue-import-file" type="file" accept=".json,application/json" onChange={(e) => void chooseFile(e.target.files?.[0])} disabled={busy} style={{ maxWidth: "100%" }} />
        </div>
        <div className="field"><label htmlFor="dialogue-import-text">또는 JSON 텍스트 붙여넣기</label>
          <textarea id="dialogue-import-text" className="textarea" rows={9} value={text} onChange={(e) => changeText(e.target.value)} disabled={busy} style={{ width: "100%", boxSizing: "border-box" }} />
        </div>
        <div className="form-actions" style={{ flexWrap: "wrap" }}>
          <button className="btn" type="button" onClick={() => { setOpen(false); changeText(""); }} disabled={busy}>취소</button>
          <button className="btn" type="button" onClick={() => void inspect()} disabled={busy || disabled || !text.trim()}>검사하기</button>
        </div>
        {error && <p role="alert" className="hint">{error}</p>}
        {inspection && <div aria-label="가져오기 미리보기" style={{ overflowWrap: "anywhere" }}>
          <h3>저장 전 미리보기</h3>
          {(inspection.document.series_title || inspection.document.episode) && <p>시리즈: {inspection.document.series_title || "-"} · 회차: {inspection.document.episode || "-"} (미리보기 전용)</p>}
          <div className="card"><strong>Cover</strong><p>제목: {inspection.document.cover.title || "(없음)"}</p><p>부제: {inspection.document.cover.subtitle || "(없음)"}</p>
            {inspection.conflicts[0].coverTitle && <p>기존 표지 제목 있음 → 가져오기 시 교체됨</p>}
            {inspection.conflicts[0].coverSubtitle && <p>기존 표지 부제 있음 → 가져오기 시 교체됨</p>}
          </div>
          {[...inspection.document.panels].sort((a, b) => a.panel_number - b.panel_number).map((p) => {
            const existing = inspection.conflicts.find((c) => c.panelNumber === p.panel_number);
            return <div className="card" key={p.panel_number}><strong>Panel {p.panel_number} · 대사 {p.dialogue.length}개</strong>
              {p.dialogue.map((d, i) => <p key={i}>{d.speaker}: “{d.text}”</p>)}
              <p>Narration: {typeof p.narration === "object" && p.narration !== null ? p.narration.text : p.narration || "(없음)"}</p>
              {existing?.dialogue && <p>기존 대사 있음 → 가져오기 시 교체됨</p>}
              {existing?.narration && <p>기존 내레이션 있음 → 가져오기 시 교체됨</p>}
            </div>;
          })}
          {conflict && <label style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "12px 0" }}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> 기존 대사/내레이션과 표지 텍스트를 교체합니다.
          </label>}
          <button className="btn btn-primary" type="button" onClick={() => void save()} disabled={busy || disabled || (conflict && !confirmed)}>대사/내레이션 가져오기</button>
        </div>}
      </div>}
    </section>
  );
}
