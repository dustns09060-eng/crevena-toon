"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  confirmStoryboardAction,
  generateStoryboardAction,
  saveStoryboardAction,
} from "../../../../lib/projects/storyboard";
import type { StoryboardDraftPanel } from "../../../../src/providers/storyboardMapper";
import type { ProjectCharacterContext } from "../../../../lib/projects/service";
import type { PanelImageView } from "../../../../lib/projects/panelImages";
import type { ToonPanel, ToonProject } from "../../../../src/db/types";
import PanelImageGenerator from "./PanelImageGenerator";

function panelsToDraftPanels(panels: ToonPanel[]): StoryboardDraftPanel[] {
  return panels.map((p) => ({
    panel_number: p.panel_number,
    scene_description: p.scene ?? "",
    character_ids: p.character_ids,
    expression: p.expression ?? "",
    dialogue: p.dialogue.map((d) => ({ id: d.id, character_id: d.character_id, text: d.text })),
    narration: p.narration,
    image_prompt: p.image_prompt ?? "",
  }));
}

function renumber(panels: StoryboardDraftPanel[]): StoryboardDraftPanel[] {
  return panels.map((p, i) => ({ ...p, panel_number: i + 1 }));
}

export default function StoryboardEditor({
  project,
  characters,
  initialPanels,
  panelImagesData,
}: {
  project: ToonProject;
  characters: ProjectCharacterContext[];
  initialPanels: ToonPanel[];
  panelImagesData: {
    readinessErrors: string[];
    images: Record<string, { approved?: PanelImageView; candidate?: PanelImageView }>;
  } | null;
}) {
  const router = useRouter();
  const [panels, setPanels] = useState<StoryboardDraftPanel[]>(() => panelsToDraftPanels(initialPanels));
  const [summary, setSummary] = useState(project.story_summary ?? "");
  const [hasStoryboard, setHasStoryboard] = useState(initialPanels.length > 0);
  const [status, setStatus] = useState(project.status);
  const [dirty, setDirty] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [generating, startGenerating] = useTransition();
  const [saving, startSaving] = useTransition();
  const [confirming, startConfirming] = useTransition();

  const busy = generating || saving || confirming;
  const charById = new Map(characters.map((c) => [c.id, c]));

  function handleGenerate() {
    setErrorMessage(null);
    setInfoMessage(null);
    startGenerating(async () => {
      const result = await generateStoryboardAction(project.id);
      if (result.ok && result.draft) {
        setPanels(result.draft.panels);
        setSummary(result.draft.summary);
        setHasStoryboard(true);
        setDirty(true);
        setInfoMessage("새로 생성된 스토리보드입니다. 확인하고 저장해주세요. (기존 저장본은 저장 전까지 유지됩니다)");
      } else {
        setErrorMessage(result.message ?? "스토리보드 생성에 실패했습니다.");
      }
    });
  }

  function handleSave() {
    setErrorMessage(null);
    startSaving(async () => {
      const result = await saveStoryboardAction(project.id, { title: project.title, summary, panels });
      if (result.ok) {
        setDirty(false);
        setInfoMessage(null);
        if (status === "draft") setStatus("storyboard");
        router.refresh();
      } else {
        setErrorMessage(result.message ?? "저장에 실패했습니다.");
      }
    });
  }

  function handleConfirm() {
    setErrorMessage(null);
    startConfirming(async () => {
      const result = await confirmStoryboardAction(project.id);
      if (result.ok) {
        setStatus("confirmed");
        router.refresh();
      } else {
        setErrorMessage(result.message ?? "확정에 실패했습니다.");
      }
    });
  }

  function updatePanel(index: number, patch: Partial<StoryboardDraftPanel>) {
    setPanels((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
    setDirty(true);
  }

  function toggleCharacterInPanel(index: number, characterId: string) {
    setPanels((prev) =>
      prev.map((p, i) => {
        if (i !== index) return p;
        const has = p.character_ids.includes(characterId);
        const nextIds = has ? p.character_ids.filter((id) => id !== characterId) : [...p.character_ids, characterId];
        // 캐릭터를 제거하면 그 캐릭터의 대사도 함께 제거한다 (허용되지 않은 화자 방지)
        const nextDialogue = has ? p.dialogue.filter((d) => d.character_id !== characterId) : p.dialogue;
        return { ...p, character_ids: nextIds, dialogue: nextDialogue };
      })
    );
    setDirty(true);
  }

  function addDialogueLine(index: number) {
    setPanels((prev) =>
      prev.map((p, i) => {
        if (i !== index || p.character_ids.length === 0) return p;
        return {
          ...p,
          dialogue: [...p.dialogue, { id: crypto.randomUUID(), character_id: p.character_ids[0], text: "" }],
        };
      })
    );
    setDirty(true);
  }

  function updateDialogueLine(index: number, lineId: string, patch: { character_id?: string; text?: string }) {
    setPanels((prev) =>
      prev.map((p, i) =>
        i !== index
          ? p
          : { ...p, dialogue: p.dialogue.map((d) => (d.id === lineId ? { ...d, ...patch } : d)) }
      )
    );
    setDirty(true);
  }

  function removeDialogueLine(index: number, lineId: string) {
    setPanels((prev) =>
      prev.map((p, i) => (i !== index ? p : { ...p, dialogue: p.dialogue.filter((d) => d.id !== lineId) }))
    );
    setDirty(true);
  }

  function movePanel(index: number, direction: -1 | 1) {
    setPanels((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return renumber(next);
    });
    setDirty(true);
  }

  return (
    <div>
      {errorMessage && <div className="banner banner-error">{errorMessage}</div>}
      {infoMessage && (
        <div className="banner banner-error" style={{ background: "#fff6e5", borderColor: "#d69b1f", color: "#8a5b00" }}>
          {infoMessage}
        </div>
      )}

      <div className="card">
        <p className="hint">
          {project.panel_count}컷 · 상태:{" "}
          {{ draft: "소재 입력됨", storyboard: "스토리보드 작성 중", confirmed: "스토리보드 확정", generating: "이미지 생성 중", completed: "완료", failed: "실패" }[status]}
        </p>
        <p className="hint">소재: {project.topic}</p>
        {dirty && <p className="error">저장하지 않은 변경사항이 있습니다.</p>}
      </div>

      {!hasStoryboard && (
        <div className="card">
          <button type="button" className="btn btn-primary btn-block" onClick={handleGenerate} disabled={busy}>
            {generating ? "스토리보드를 만들고 있어요..." : "스토리보드 생성하기"}
          </button>
        </div>
      )}

      {hasStoryboard && (
        <>
          {summary && (
            <div className="card">
              <label htmlFor="summary">스토리 요약</label>
              <textarea
                id="summary"
                className="textarea"
                value={summary}
                onChange={(e) => {
                  setSummary(e.target.value);
                  setDirty(true);
                }}
              />
            </div>
          )}

          {panels.map((panel, index) => (
            <div className="card" key={index}>
              <div className="topbar" style={{ padding: "0 0 8px" }}>
                <h2 style={{ fontSize: 15, margin: 0 }}>컷 {panel.panel_number}</h2>
                <div style={{ display: "flex", gap: 4 }}>
                  <button type="button" className="btn" onClick={() => movePanel(index, -1)} disabled={index === 0 || busy}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => movePanel(index, 1)}
                    disabled={index === panels.length - 1 || busy}
                  >
                    ↓
                  </button>
                </div>
              </div>

              <div className="field">
                <label>장면</label>
                <textarea
                  className="textarea"
                  value={panel.scene_description}
                  onChange={(e) => updatePanel(index, { scene_description: e.target.value })}
                  maxLength={300}
                />
              </div>

              <div className="field">
                <label>등장인물</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  {characters.map((c) => (
                    <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={panel.character_ids.includes(c.id)}
                        onChange={() => toggleCharacterInPanel(index, c.id)}
                      />
                      {c.display_name}
                    </label>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>표정/행동</label>
                <input
                  className="input"
                  value={panel.expression}
                  onChange={(e) => updatePanel(index, { expression: e.target.value })}
                  maxLength={300}
                />
              </div>

              <div className="field">
                <label>대사</label>
                {panel.dialogue.map((line) => (
                  <div key={line.id} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                    <select
                      className="input"
                      style={{ maxWidth: 100 }}
                      value={line.character_id}
                      onChange={(e) => updateDialogueLine(index, line.id, { character_id: e.target.value })}
                    >
                      {panel.character_ids.map((cid) => (
                        <option key={cid} value={cid}>
                          {charById.get(cid)?.display_name ?? "?"}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input"
                      value={line.text}
                      onChange={(e) => updateDialogueLine(index, line.id, { text: e.target.value })}
                      maxLength={200}
                    />
                    <button type="button" className="btn" onClick={() => removeDialogueLine(index, line.id)}>
                      삭제
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn"
                  onClick={() => addDialogueLine(index)}
                  disabled={panel.character_ids.length === 0}
                >
                  + 대사 추가
                </button>
              </div>

              <div className="field">
                <label>내레이션</label>
                <input
                  className="input"
                  value={panel.narration ?? ""}
                  onChange={(e) => updatePanel(index, { narration: e.target.value || null })}
                  maxLength={200}
                />
              </div>
            </div>
          ))}

          <div className="card">
            <div className="form-actions" style={{ marginTop: 0 }}>
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={busy}>
                {saving ? "저장 중..." : "스토리보드 저장"}
              </button>
              <button type="button" className="btn" onClick={handleGenerate} disabled={busy}>
                {generating ? "생성 중..." : "다시 만들기"}
              </button>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirm}
                disabled={busy || dirty || (status !== "storyboard" && status !== "confirmed")}
              >
                {confirming ? "확정 중..." : status === "confirmed" ? "확정됨" : "스토리보드 확정"}
              </button>
            </div>
          </div>

          {status === "confirmed" && panelImagesData && (
            <div className="card">
              <h2 style={{ fontSize: 15, marginTop: 0 }}>컷 이미지</h2>
              <PanelImageGenerator
                panels={initialPanels}
                initialImages={panelImagesData.images}
                initialReadinessErrors={panelImagesData.readinessErrors}
              />
            </div>
          )}

          {status !== "confirmed" && (
            <div className="card">
              <button type="button" className="btn btn-block" disabled title="먼저 스토리보드를 확정해주세요">
                컷 이미지 만들기 (스토리보드 확정 필요)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
