"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  confirmStoryboardAction,
  generateStoryboardAction,
  regenerateStoryboardWithSettingsAction,
  saveStoryboardAction,
} from "../../../../lib/projects/storyboard";
import type { StoryboardDraftPanel, StoryboardDraftTemporaryLocation } from "../../../../src/providers/storyboardMapper";
import type { ProjectCharacterContext } from "../../../../lib/projects/service";
import type { PanelImageView } from "../../../../lib/projects/panelImages";
import type { ToonPanel, ToonProject } from "../../../../src/db/types";
import {
  MAX_CHARACTERS_PER_PANEL,
  PROJECT_TOTAL_PANEL_COUNT_MAX,
  PROJECT_TOTAL_PANEL_COUNT_MIN,
} from "../../../../src/providers/projectPanelCountConfig";
import PanelImageGenerator from "./PanelImageGenerator";

/** 022 — 이 프로젝트가 지금까지 정의한 Temporary Location(전체 정의). */
export interface ProjectLocationOption {
  id: string;
  location_key: string;
  display_name: string;
  visual_prompt: string;
  wall_and_floor: string | null;
  fixed_furniture: string | null;
  window_style: string | null;
  recurring_props: string | null;
  distinctive_features: string | null;
}

/**
 * 022 — toon_panels는 project_location_id(UUID)만 들고 있고 AI용
 * key("TEMP_A")는 toon_project_locations에만 있다. draft/저장 계층은
 * 항상 key로 통신하므로(아직 DB row가 없는 새 temp location도 다뤄야
 * 하기 때문), 기존 저장된 panel을 다시 draft로 불러올 때는 이 map으로
 * id -> key를 역변환한다.
 */
function panelsToDraftPanels(panels: ToonPanel[], projectLocations: ProjectLocationOption[]): StoryboardDraftPanel[] {
  const idToKey = new Map(projectLocations.map((l) => [l.id, l.location_key]));
  return panels.map((p) => ({
    panel_number: p.panel_number,
    panel_type: p.panel_type,
    scene_description: p.scene ?? "",
    character_ids: p.character_ids,
    expression: p.expression ?? "",
    dialogue: p.dialogue.map((d) => ({ id: d.id, character_id: d.character_id, text: d.text })),
    narration: p.narration,
    image_prompt: p.image_prompt ?? "",
    cover_title: p.cover_title,
    cover_subtitle: p.cover_subtitle,
    location_id: p.location_id,
    time_of_day: p.time_of_day,
    temp_location_key: p.project_location_id ? (idToKey.get(p.project_location_id) ?? null) : null,
  }));
}

/** 022 — 초기 로드 시 실제로 panel이 참조하는 temp location만 draft에 싣는다. */
function deriveInitialTemporaryLocations(
  panels: StoryboardDraftPanel[],
  projectLocations: ProjectLocationOption[]
): StoryboardDraftTemporaryLocation[] {
  const usedKeys = new Set(panels.map((p) => p.temp_location_key).filter((k): k is string => Boolean(k)));
  return projectLocations
    .filter((l) => usedKeys.has(l.location_key))
    .map((l) => ({
      location_key: l.location_key,
      display_name: l.display_name,
      visual_prompt: l.visual_prompt,
      wall_and_floor: l.wall_and_floor,
      fixed_furniture: l.fixed_furniture,
      window_style: l.window_style,
      recurring_props: l.recurring_props,
      distinctive_features: l.distinctive_features,
    }));
}

function renumber(panels: StoryboardDraftPanel[]): StoryboardDraftPanel[] {
  return panels.map((p, i) => ({ ...p, panel_number: i + 1 }));
}

function makeEmptyScenePanel(panelNumber: number): StoryboardDraftPanel {
  return {
    panel_number: panelNumber,
    panel_type: "scene",
    scene_description: "",
    character_ids: [],
    expression: "",
    dialogue: [],
    narration: null,
    image_prompt: "",
    cover_title: null,
    cover_subtitle: null,
    location_id: null,
    time_of_day: null,
    temp_location_key: null,
  };
}

const TIME_OF_DAY_OPTIONS: { value: NonNullable<StoryboardDraftPanel["time_of_day"]>; label: string }[] = [
  { value: "MORNING", label: "아침" },
  { value: "DAY", label: "낮" },
  { value: "EVENING", label: "저녁" },
  { value: "NIGHT", label: "밤" },
  { value: "LATE_NIGHT", label: "늦은 밤" },
];

export default function StoryboardEditor({
  project,
  characters,
  allCharacters,
  allLocations,
  projectLocations,
  initialPanels,
  panelImagesData,
}: {
  project: ToonProject;
  characters: ProjectCharacterContext[];
  allCharacters: { id: string; display_name: string; role: string }[];
  allLocations: { id: string; display_name: string }[];
  /** 022 — 이 프로젝트가 지금까지 정의한 Temporary Location(전체). 사용자는 직접 관리하지 않고 읽기 전용 배지로만 노출한다. */
  projectLocations: ProjectLocationOption[];
  initialPanels: ToonPanel[];
  panelImagesData: {
    readinessErrors: string[];
    images: Record<string, { approved?: PanelImageView; candidate?: PanelImageView }>;
  } | null;
}) {
  const router = useRouter();
  const [panels, setPanels] = useState<StoryboardDraftPanel[]>(() =>
    panelsToDraftPanels(initialPanels, projectLocations)
  );
  const [temporaryLocations, setTemporaryLocations] = useState<StoryboardDraftTemporaryLocation[]>(() =>
    deriveInitialTemporaryLocations(panelsToDraftPanels(initialPanels, projectLocations), projectLocations)
  );
  const [summary, setSummary] = useState(project.story_summary ?? "");
  const [hasStoryboard, setHasStoryboard] = useState(initialPanels.length > 0);
  const [status, setStatus] = useState(project.status);
  const [dirty, setDirty] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [generating, startGenerating] = useTransition();
  const [saving, startSaving] = useTransition();
  const [confirming, startConfirming] = useTransition();

  // 설정 수정(소재/컷수/등장인물) — 생성 이후에도 프로젝트를 새로
  // 만들지 않고 바꿀 수 있게 한다.
  const [currentTopic, setCurrentTopic] = useState(project.topic ?? "");
  const [currentPanelCount, setCurrentPanelCount] = useState(project.panel_count);
  const [currentCharacterIds, setCurrentCharacterIds] = useState(characters.map((c) => c.id));
  const [showSettingsForm, setShowSettingsForm] = useState(false);
  const [settingsTopic, setSettingsTopic] = useState(currentTopic);
  const [settingsPanelCount, setSettingsPanelCount] = useState(currentPanelCount);
  const [settingsCharacterIds, setSettingsCharacterIds] = useState<string[]>(currentCharacterIds);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsPending, startSettingsTransition] = useTransition();

  const busy = generating || saving || confirming || settingsPending;
  const charById = new Map(characters.map((c) => [c.id, c]));
  const hasAnyGeneratedImage = initialPanels.some((p) => p.raw_image_url || p.image_url);

  function handleGenerate(skipConfirm = false) {
    if (!skipConfirm && hasAnyGeneratedImage) {
      const ok = window.confirm(
        "스토리보드를 다시 만들까요?\n현재 작성된 표지와 장면 내용이 새로운 설정으로 변경됩니다.\n이미 생성한 캐릭터와 Character Sheet는 변경되지 않습니다."
      );
      if (!ok) return;
    }
    setErrorMessage(null);
    setInfoMessage(null);
    startGenerating(async () => {
      const result = await generateStoryboardAction(project.id);
      if (result.ok && result.draft) {
        setPanels(result.draft.panels);
        setTemporaryLocations(result.draft.temporaryLocations);
        setSummary(result.draft.summary);
        setHasStoryboard(true);
        setDirty(true);
        setInfoMessage("새로 생성된 스토리보드입니다. 확인하고 저장해주세요. (기존 저장본은 저장 전까지 유지됩니다)");
      } else {
        setErrorMessage(result.message ?? "스토리보드 생성에 실패했습니다.");
      }
    });
  }

  function openSettingsForm() {
    setSettingsTopic(currentTopic);
    setSettingsPanelCount(currentPanelCount);
    setSettingsCharacterIds(currentCharacterIds);
    setSettingsError(null);
    setShowSettingsForm(true);
  }

  function toggleSettingsCharacter(id: string) {
    setSettingsCharacterIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function submitSettings(confirmDiscardImages = false) {
    setSettingsError(null);
    startSettingsTransition(async () => {
      // regenerateStoryboardWithSettingsAction은 2-phase로 동작한다:
      // 새 설정으로 AI를 먼저 호출해 검증까지 통과한 뒤에만 실제로
      // topic/panel_count/등장인물/panels를 함께 반영한다. 즉 AI가
      // 실패하면 여기 도달하기 전에 이미 실패로 끝나고, 기존 설정과
      // 스토리보드/이미지는 전혀 바뀌지 않은 채로 남는다.
      const result = await regenerateStoryboardWithSettingsAction(
        project.id,
        { topic: settingsTopic, panel_count: settingsPanelCount, character_ids: settingsCharacterIds },
        confirmDiscardImages
      );
      if (result.ok && result.draft) {
        setCurrentTopic(settingsTopic);
        setCurrentPanelCount(settingsPanelCount);
        setCurrentCharacterIds(settingsCharacterIds);
        setPanels(result.draft.panels);
        setTemporaryLocations(result.draft.temporaryLocations);
        setSummary(result.draft.summary);
        setHasStoryboard(true);
        setDirty(false);
        setShowSettingsForm(false);
        setInfoMessage("새 설정으로 스토리보드를 만들어 저장했습니다. 내용을 확인해주세요.");
        if (status === "draft") setStatus("storyboard");
        router.refresh();
        return;
      }
      if (result.needsImageConfirmation) {
        const ok = window.confirm(
          `이미 생성된 이미지가 있습니다.\n컷수를 ${settingsPanelCount}장으로 줄이면 컷 ${result.affectedPanelNumbers?.join(", ")}의 이미지가 삭제됩니다.\n계속할까요?`
        );
        if (ok) submitSettings(true);
        return;
      }
      setSettingsError(result.message ?? "설정 저장에 실패했습니다.");
    });
  }

  function handleSave() {
    setErrorMessage(null);
    startSaving(async () => {
      const result = await saveStoryboardAction(project.id, {
        title: project.title,
        summary,
        panels,
        temporaryLocations,
      });
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
    const current = panels[index];
    if (current && !current.character_ids.includes(characterId) && current.character_ids.length >= MAX_CHARACTERS_PER_PANEL) {
      setErrorMessage(`한 장면에는 최대 ${MAX_CHARACTERS_PER_PANEL}명의 등장인물을 사용할 수 있어요.`);
      return;
    }
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
      // 표지는 항상 첫 번째 컷이어야 하므로, 표지가 있는 프로젝트에서는
      // 0번 위치로 들어오거나 나가는 이동을 막는다.
      if (prev[0]?.panel_type === "cover" && (index === 0 || target === 0)) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return renumber(next);
    });
    setDirty(true);
  }

  function addScene() {
    setErrorMessage(null);
    if (panels.length >= PROJECT_TOTAL_PANEL_COUNT_MAX) {
      setErrorMessage(`표지 포함 최대 ${PROJECT_TOTAL_PANEL_COUNT_MAX}장까지 만들 수 있어요.`);
      return;
    }
    setPanels((prev) => renumber([...prev, makeEmptyScenePanel(prev.length + 1)]));
    setDirty(true);
  }

  function removeScene(index: number) {
    setErrorMessage(null);
    if (panels[index]?.panel_type === "cover") {
      setErrorMessage("표지는 삭제할 수 없어요.");
      return;
    }
    if (panels.length <= PROJECT_TOTAL_PANEL_COUNT_MIN) {
      setErrorMessage(`최소 ${PROJECT_TOTAL_PANEL_COUNT_MIN}장(표지 포함)은 있어야 해요.`);
      return;
    }
    setPanels((prev) => renumber(prev.filter((_, i) => i !== index)));
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
          총 이미지 {currentPanelCount}장 (표지 포함) · 상태:{" "}
          {{ draft: "소재 입력됨", storyboard: "스토리보드 작성 중", confirmed: "스토리보드 확정", generating: "이미지 생성 중", completed: "완료", failed: "실패" }[status]}
        </p>
        <p className="hint">소재: {currentTopic}</p>
        <p className="hint">
          등장인물: {allCharacters.filter((c) => currentCharacterIds.includes(c.id)).map((c) => c.display_name).join(" / ") || "없음"}
        </p>
        {dirty && <p className="error">저장하지 않은 변경사항이 있습니다.</p>}

        {status !== "completed" && !showSettingsForm && (
          <button type="button" className="btn" onClick={openSettingsForm} disabled={busy}>
            설정 수정
          </button>
        )}

        {showSettingsForm && (
          <div style={{ marginTop: 12, borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
            {settingsError && <p className="error">{settingsError}</p>}
            <div className="field">
              <label>소재</label>
              <textarea
                className="textarea"
                value={settingsTopic}
                onChange={(e) => setSettingsTopic(e.target.value)}
                maxLength={1000}
              />
            </div>
            <div className="field">
              <label>총 이미지 수 (표지 포함 {settingsPanelCount}장)</label>
              <input
                type="range"
                min={PROJECT_TOTAL_PANEL_COUNT_MIN}
                max={PROJECT_TOTAL_PANEL_COUNT_MAX}
                value={settingsPanelCount}
                onChange={(e) => setSettingsPanelCount(Number(e.target.value))}
                style={{ width: "100%" }}
              />
              <p className="hint">
                최소 {PROJECT_TOTAL_PANEL_COUNT_MIN}장 ~ 최대 {PROJECT_TOTAL_PANEL_COUNT_MAX}장
              </p>
            </div>
            <div className="field">
              <label>등장인물</label>
              {allCharacters.map((c) => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                  <input
                    type="checkbox"
                    checked={settingsCharacterIds.includes(c.id)}
                    onChange={() => toggleSettingsCharacter(c.id)}
                  />
                  {c.display_name} <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>({c.role})</span>
                </label>
              ))}
              <button type="button" className="btn" style={{ marginTop: 6 }} onClick={() => (window.location.href = "/toon/characters/new")}>
                + 새로운 등장인물 추가
              </button>
            </div>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setShowSettingsForm(false)} disabled={settingsPending}>
                취소
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => submitSettings(false)}
                disabled={settingsPending || settingsTopic.trim().length === 0 || settingsCharacterIds.length === 0}
              >
                {settingsPending ? "처리 중..." : "수정하고 스토리보드 다시 만들기"}
              </button>
            </div>
          </div>
        )}
      </div>

      {!hasStoryboard && (
        <div className="card">
          <button type="button" className="btn btn-primary btn-block" onClick={() => handleGenerate()} disabled={busy}>
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

          <p className="hint">표지 포함 최소 {PROJECT_TOTAL_PANEL_COUNT_MIN}장 ~ 최대 {PROJECT_TOTAL_PANEL_COUNT_MAX}장까지 만들 수 있어요.</p>

          {panels.map((panel, index) => {
            const isCover = panel.panel_type === "cover";
            return (
              <div className="card" key={index} style={isCover ? { borderColor: "var(--color-primary)", borderWidth: 2 } : undefined}>
                <div className="topbar" style={{ padding: "0 0 8px" }}>
                  <h2 style={{ fontSize: 15, margin: 0 }}>{isCover ? "표지" : `컷 ${panel.panel_number - (panels[0]?.panel_type === "cover" ? 1 : 0)}`}</h2>
                  {!isCover && (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => movePanel(index, -1)}
                        disabled={busy || (panels[0]?.panel_type === "cover" ? index <= 1 : index === 0)}
                      >
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
                      <button type="button" className="btn" onClick={() => removeScene(index)} disabled={busy}>
                        삭제
                      </button>
                    </div>
                  )}
                </div>

                {isCover && (
                  <>
                    <div className="field">
                      <label>표지 제목</label>
                      <input
                        className="input"
                        value={panel.cover_title ?? ""}
                        onChange={(e) => updatePanel(index, { cover_title: e.target.value || null })}
                        maxLength={60}
                      />
                    </div>
                    <div className="field">
                      <label>부제목 (선택)</label>
                      <input
                        className="input"
                        value={panel.cover_subtitle ?? ""}
                        onChange={(e) => updatePanel(index, { cover_subtitle: e.target.value || null })}
                        maxLength={100}
                      />
                    </div>
                  </>
                )}

                <div className="field">
                  <label>{isCover ? "표지 장면 설명" : "장면"}</label>
                  <textarea
                    className="textarea"
                    value={panel.scene_description}
                    onChange={(e) => updatePanel(index, { scene_description: e.target.value })}
                    maxLength={300}
                  />
                </div>

                <details className="field">
                  <summary style={{ cursor: "pointer" }}>고급 설정 — 이미지 연출 지시</summary>
                  <div style={{ marginTop: 8 }}>
                    <label>이미지 연출 지시 (선택)</label>
                    <textarea
                      className="textarea"
                      value={panel.image_prompt}
                      onChange={(e) => updatePanel(index, { image_prompt: e.target.value })}
                      maxLength={500}
                    />
                    <p className="hint">
                      AI가 이미지를 그릴 때 참고하는 카메라 구도/동작 지시예요. 장면과 다른 내용을 그리거나
                      원치 않는 동작(예: 점프하는 중간 동작)이 나온다면 여기서 직접 고쳐보세요.
                    </p>
                  </div>
                </details>

                {panel.temp_location_key && (
                  <div className="field">
                    <label>장소</label>
                    <p className="hint">
                      🏷️{" "}
                      {temporaryLocations.find((l) => l.location_key === panel.temp_location_key)?.display_name ??
                        "임시 장소"}{" "}
                      · 이번 화
                    </p>
                    <p className="hint">
                      AI가 이번 화에만 쓰는 장소로 즉석 정의했어요. 저장된 장소로 바꾸려면 아래에서 선택하세요.
                    </p>
                  </div>
                )}

                {allLocations.length > 0 && (
                  <div className="field">
                    <label>{panel.temp_location_key ? "저장된 장소로 바꾸기 (선택)" : "장소 (선택)"}</label>
                    <select
                      className="input"
                      value={panel.location_id ?? ""}
                      onChange={(e) =>
                        updatePanel(index, { location_id: e.target.value || null, temp_location_key: null })
                      }
                    >
                      <option value="">선택 안 함</option>
                      {allLocations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.display_name}
                        </option>
                      ))}
                    </select>
                    {!panel.temp_location_key && <p className="hint">AI가 자동으로 배정했어요. 다르면 직접 바꿔주세요.</p>}
                  </div>
                )}

                <div className="field">
                  <label>시간대 (선택)</label>
                  <select
                    className="input"
                    value={panel.time_of_day ?? ""}
                    onChange={(e) =>
                      updatePanel(index, {
                        time_of_day: (e.target.value || null) as StoryboardDraftPanel["time_of_day"],
                      })
                    }
                  >
                    <option value="">선택 안 함</option>
                    {TIME_OF_DAY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label>등장인물 (최대 {MAX_CHARACTERS_PER_PANEL}명)</label>
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

                {!isCover && (
                  <>
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
                  </>
                )}
              </div>
            );
          })}

          <div className="card">
            <button
              type="button"
              className="btn btn-block"
              onClick={addScene}
              disabled={busy || panels.length >= PROJECT_TOTAL_PANEL_COUNT_MAX}
            >
              + 장면 추가
            </button>
          </div>

          <div className="card">
            <div className="form-actions" style={{ marginTop: 0 }}>
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={busy}>
                {saving ? "저장 중..." : "스토리보드 저장"}
              </button>
              <button type="button" className="btn" onClick={() => handleGenerate()} disabled={busy}>
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
                allLocations={allLocations}
                projectLocations={projectLocations}
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
