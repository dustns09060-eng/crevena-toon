"use client";

import { scriptToJson } from "../../../../../lib/editor/scriptImport";
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
  const [mode, setMode] = useState<"json" | "script">("script");
  const [prepared, setPrepared] = useState("");
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
    try { setMode("json"); changeText(await readDialogueImportFile(file)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "JSON 파일을 읽지 못했습니다."); }
  }

  async function inspect() {
    setBusy(true); setError(""); setInspection(null); setConfirmed(false);
    try {
      const json = mode === "script" && !text.trim().startsWith("{") ? scriptToJson(text) : text;
      setPrepared(json);
      const result = await inspectDialogueImportAction(projectId, json);
      if (result.ok) setInspection(result);
      else setError(result.message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "검사하지 못했습니다. 다시 시도해주세요."); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!inspection || (conflict && !confirmed)) return;
    setBusy(true); setError("");
    try {
      const result = await saveDialogueImportAction(projectId, prepared, inspection.fingerprint, confirmed);
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
        <label className="field">입력 방식<select className="input" value={mode} disabled={busy} onChange={e=>{setMode(e.target.value as "json"|"script");changeText("");}}><option value="script">일반 대본 붙여넣기</option><option value="json">JSON 붙여넣기</option></select></label>
        {mode === "script" && <p className="hint">표지 제목: 제목 / 표지 부제: 부제를 각각 한 줄에 적으세요. 본문은 아래 예시처럼 입력합니다. 장면 설명은 이미지에 표시되지 않습니다. 자동 변환에는 AI 비용이 없습니다.</p>}
        <p className="hint"> 표지 제목·부제와 가져올 컷 번호를 적으세요. 빠진 Panel은 그대로 둡니다. 화자는 프로젝트 캐릭터 이름과 정확히 일치해야 합니다.</p>
        <div className="field"><label htmlFor="dialogue-import-file">JSON 파일</label>
          <input id="dialogue-import-file" type="file" accept=".json,application/json" onChange={(e) => void chooseFile(e.target.files?.[0])} disabled={busy} style={{ maxWidth: "100%" }} />
        </div>
        <div className="field"><label htmlFor="dialogue-import-text">{mode === "script" ? "대본 붙여넣기" : "또는 JSON 텍스트 붙여넣기"}</label>
          <textarea id="dialogue-import-text" className="textarea" rows={9} placeholder={mode === "script" ? "표지 제목: 육아맘, 간호조무사 도전기\n표지 부제: EP.03 처음으로 분만실에 들어갔습니다\n1컷 | 실습복을 챙기는 장면 | 유별: 오늘부터 실습이구나! / 내레이션: 첫 실습 날." : "{…}"} value={text} onChange={(e) => changeText(e.target.value)} disabled={busy} style={{ width: "100%", boxSizing: "border-box" }} />
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
