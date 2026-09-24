"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  approvePanelImageAction,
  editPanelImageAction,
  generatePanelImageAction,
  updatePanelLocationAction,
  type PanelImageView,
} from "../../../../lib/projects/panelImages";
import type { ToonPanel, ToonTimeOfDay } from "../../../../src/db/types";

interface PanelImagesState {
  approved?: PanelImageView;
  candidate?: PanelImageView;
}

const TIME_OF_DAY_OPTIONS: { value: ToonTimeOfDay; label: string }[] = [
  { value: "MORNING", label: "아침" },
  { value: "DAY", label: "낮" },
  { value: "EVENING", label: "저녁" },
  { value: "NIGHT", label: "밤" },
  { value: "LATE_NIGHT", label: "늦은 밤" },
];

export default function PanelImageGenerator({
  panels,
  initialImages,
  initialReadinessErrors,
  allLocations,
  projectLocations,
}: {
  panels: ToonPanel[];
  initialImages: Record<string, PanelImagesState>;
  initialReadinessErrors: string[];
  /** 021 — 이 시리즈의 Location Set. 없으면 빈 배열(Location 선택 UI 자체를 숨긴다). */
  allLocations: { id: string; display_name: string }[];
  /** 022 — 이 프로젝트의 Temporary Location. 읽기 전용 배지 표시에만 쓴다. */
  projectLocations: { id: string; location_key: string; display_name: string }[];
}) {
  const projectLocationById = new Map(projectLocations.map((l) => [l.id, l]));
  const [images, setImages] = useState<Record<string, PanelImagesState>>(initialImages);
  const [statusByPanel, setStatusByPanel] = useState<Record<string, "idle" | "generating" | "failed">>({});
  const [errorByPanel, setErrorByPanel] = useState<Record<string, string>>({});
  const [runningAll, setRunningAll] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [readinessErrors] = useState(initialReadinessErrors);
  const generatingPanelsRef = useRef(new Set<string>());
  const generateAllRef = useRef(false);

  // 021 — Storyboard 전체 재생성 없이 기존(확정된) 컷의 Location/Time of
  // Day만 직접 지정/수정한다. 저장 후 "이 컷 다시 만들기"로 새
  // candidate를 생성하면 바뀐 값이 반영된다.
  const [locationByPanel, setLocationByPanel] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(panels.map((p) => [p.id, p.location_id]))
  );
  const [timeByPanel, setTimeByPanel] = useState<Record<string, ToonTimeOfDay | null>>(() =>
    Object.fromEntries(panels.map((p) => [p.id, p.time_of_day]))
  );
  const [locationSavingPanel, setLocationSavingPanel] = useState<string | null>(null);
  const [locationSavedPanel, setLocationSavedPanel] = useState<string | null>(null);
  const [locationErrorByPanel, setLocationErrorByPanel] = useState<Record<string, string>>({});

  // 부분 수정 — 기존 candidate 이미지를 원본으로 텍스트 지시 기반 최소
  // 수정을 요청한다. "부분 수정" 버튼을 누른 패널만 인라인 입력창을
  // 펼치고, 그 패널의 현재 candidate.id를 sourcePanelImageId로 그대로
  // 전달한다(다른 패널/승인된 이미지로 잘못 전달될 여지가 없다).
  const [editOpenPanel, setEditOpenPanel] = useState<string | null>(null);
  const [editInstructionByPanel, setEditInstructionByPanel] = useState<Record<string, string>>({});
  const [editingPanel, setEditingPanel] = useState<string | null>(null);
  const [editErrorByPanel, setEditErrorByPanel] = useState<Record<string, string>>({});

  async function handleSaveLocation(panelId: string) {
    setLocationSavingPanel(panelId);
    setLocationSavedPanel(null);
    setLocationErrorByPanel((prev) => {
      const next = { ...prev };
      delete next[panelId];
      return next;
    });
    const result = await updatePanelLocationAction(panelId, {
      location_id: locationByPanel[panelId] ?? null,
      time_of_day: timeByPanel[panelId] ?? null,
    });
    setLocationSavingPanel(null);
    if (result.ok) {
      setLocationSavedPanel(panelId);
    } else {
      setLocationErrorByPanel((prev) => ({ ...prev, [panelId]: result.message ?? "저장에 실패했습니다." }));
    }
  }

  const approvedCount = panels.filter((p) => images[p.id]?.approved).length;
  const allApproved = panels.length > 0 && approvedCount === panels.length;

  async function generateOne(panelId: string): Promise<boolean> {
    if (generatingPanelsRef.current.has(panelId)) return false;
    generatingPanelsRef.current.add(panelId);
    setStatusByPanel((prev) => ({ ...prev, [panelId]: "generating" }));
    setErrorByPanel((prev) => {
      const next = { ...prev };
      delete next[panelId];
      return next;
    });

    try {
      const result = await generatePanelImageAction(panelId);
      if (result.ok && result.image) {
        setImages((prev) => ({ ...prev, [panelId]: { ...prev[panelId], candidate: result.image } }));
        setStatusByPanel((prev) => ({ ...prev, [panelId]: "idle" }));
        return true;
      }

      setStatusByPanel((prev) => ({ ...prev, [panelId]: "failed" }));
      setErrorByPanel((prev) => ({ ...prev, [panelId]: result.message ?? "생성에 실패했습니다." }));
      return false;
    } finally {
      generatingPanelsRef.current.delete(panelId);
    }
  }

  async function handleGenerateAll() {
    if (generateAllRef.current) return;
    generateAllRef.current = true;
    setGlobalError(null);
    setRunningAll(true);
    try {
      for (const panel of panels) {
        if (images[panel.id]?.approved) continue; // 이미 승인된 컷은 재생성하지 않는다
        const ok = await generateOne(panel.id);
        if (!ok) break; // 실패하면 멈춘다 — 나머지는 사용자가 "이어서 생성"으로 재시도
      }
    } finally {
      setRunningAll(false);
      generateAllRef.current = false;
    }
  }

  function openEdit(panelId: string) {
    setEditOpenPanel(panelId);
    setEditErrorByPanel((prev) => {
      const next = { ...prev };
      delete next[panelId];
      return next;
    });
  }

  function cancelEdit(panelId: string) {
    setEditOpenPanel(null);
    setEditErrorByPanel((prev) => {
      const next = { ...prev };
      delete next[panelId];
      return next;
    });
  }

  async function handleEditOne(panelId: string) {
    const sourceImage = images[panelId]?.candidate;
    if (!sourceImage) return;
    setEditingPanel(panelId);
    setEditErrorByPanel((prev) => {
      const next = { ...prev };
      delete next[panelId];
      return next;
    });

    const result = await editPanelImageAction(sourceImage.id, editInstructionByPanel[panelId] ?? "");
    setEditingPanel(null);
    if (result.ok && result.image) {
      setImages((prev) => ({ ...prev, [panelId]: { ...prev[panelId], candidate: result.image } }));
      setEditOpenPanel(null);
      setEditInstructionByPanel((prev) => ({ ...prev, [panelId]: "" }));
    } else {
      setEditErrorByPanel((prev) => ({ ...prev, [panelId]: result.message ?? "수정에 실패했습니다." }));
    }
  }

  async function handleApprove(panelId: string) {
    const candidate = images[panelId]?.candidate;
    if (!candidate) return;
    const result = await approvePanelImageAction(panelId, candidate.id);
    if (result.ok) {
      setImages((prev) => ({
        ...prev,
        [panelId]: { approved: { ...candidate, status: "approved" }, candidate: undefined },
      }));
    } else {
      setErrorByPanel((prev) => ({ ...prev, [panelId]: result.message ?? "승인에 실패했습니다." }));
    }
  }

  const remaining = panels.length - approvedCount;

  return (
    <div>
      {readinessErrors.length > 0 && (
        <div className="banner banner-error">
          아직 이미지를 생성할 수 없습니다:
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {readinessErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {globalError && <div className="banner banner-error">{globalError}</div>}

      {readinessErrors.length === 0 && (
        <>
          <p className="hint">
            {approvedCount} / {panels.length} 컷 승인 완료
            {runningAll && " · 순차 생성 중..."}
          </p>

          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={handleGenerateAll}
            disabled={runningAll || remaining === 0}
          >
            {runningAll ? "생성 중..." : remaining === panels.length ? "전체 컷 이미지 만들기" : "이어서 생성하기"}
          </button>

          {panels.map((panel) => {
            const state = images[panel.id] ?? {};
            const status = statusByPanel[panel.id] ?? "idle";
            const error = errorByPanel[panel.id];
            // 새 후보가 생기면 기존 approved 이미지는 안전하게 유지하되,
            // 사용자가 비교·승인할 수 있도록 후보를 화면에 우선 표시한다.
            const displayedImage = state.candidate ?? state.approved;

            return (
              <div className="card" key={panel.id}>
                <h3 style={{ fontSize: 14, marginTop: 0 }}>컷 {panel.panel_number}</h3>
                <p className="hint" style={{ marginTop: 0 }}>
                  {panel.scene}
                </p>

                {panel.project_location_id && projectLocationById.has(panel.project_location_id) && (
                  <p className="hint">🏷️ {projectLocationById.get(panel.project_location_id)!.display_name} · 이번 화</p>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  {allLocations.length > 0 && (
                    <select
                      className="input"
                      style={{ maxWidth: 160 }}
                      value={locationByPanel[panel.id] ?? ""}
                      onChange={(e) =>
                        setLocationByPanel((prev) => ({ ...prev, [panel.id]: e.target.value || null }))
                      }
                    >
                      <option value="">장소 선택 안 함</option>
                      {allLocations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.display_name}
                        </option>
                      ))}
                    </select>
                  )}
                  <select
                    className="input"
                    style={{ maxWidth: 120 }}
                    value={timeByPanel[panel.id] ?? ""}
                    onChange={(e) =>
                      setTimeByPanel((prev) => ({
                        ...prev,
                        [panel.id]: (e.target.value || null) as ToonTimeOfDay | null,
                      }))
                    }
                  >
                    <option value="">시간대 선택 안 함</option>
                    {TIME_OF_DAY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => handleSaveLocation(panel.id)}
                    disabled={locationSavingPanel === panel.id}
                  >
                    {locationSavingPanel === panel.id ? "저장 중..." : "장소/시간대 저장"}
                  </button>
                </div>
                {locationSavedPanel === panel.id && (
                  <p className="hint">저장했어요. 이 컷을 다시 만들면 반영됩니다.</p>
                )}
                {locationErrorByPanel[panel.id] && <p className="error">{locationErrorByPanel[panel.id]}</p>}

                <p className="hint">
                  상태:{" "}
                  {status === "generating"
                    ? "생성 중..."
                    : state.candidate
                      ? state.approved
                        ? "새 후보 확인 필요 (기존 승인본 유지 중)"
                        : "후보"
                      : state.approved
                        ? "승인됨"
                        : status === "failed"
                          ? "실패"
                          : "대기"}
                </p>

                {error && <p className="error">{error}</p>}

                {displayedImage?.signedUrl && (
                  <>
                    {state.candidate && (
                      <p className="hint" style={{ fontWeight: 700 }}>
                        새 후보 이미지 · v{state.candidate.generationVersion}
                      </p>
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={displayedImage.signedUrl}
                      alt={state.candidate ? "새 후보 이미지" : "승인된 이미지"}
                      style={{ width: "100%", borderRadius: 12, border: "1px solid var(--color-border)" }}
                    />
                  </>
                )}

                {state.candidate && state.approved?.signedUrl && (
                  <details style={{ marginTop: 10 }}>
                    <summary className="hint" style={{ cursor: "pointer" }}>
                      기존 승인 이미지와 비교
                    </summary>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={state.approved.signedUrl}
                      alt="기존 승인 이미지"
                      style={{
                        width: "100%",
                        marginTop: 8,
                        borderRadius: 12,
                        border: "1px solid var(--color-border)",
                      }}
                    />
                  </details>
                )}

                {state.candidate && (
                  <p className="hint">
                    AI 이미지에 글자, 서명, 로고, 빈 말풍선 등이 이미 그려져 있지 않은지 확인해 주세요.
                  </p>
                )}

                <div className="form-actions">
                  {state.candidate && (
                    <button type="button" className="btn btn-primary" onClick={() => handleApprove(panel.id)}>
                      이 이미지 사용
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => generateOne(panel.id)}
                    disabled={status === "generating" || runningAll}
                  >
                    {status === "generating" ? "생성 중..." : "이 컷 다시 만들기"}
                  </button>
                  {state.candidate && editOpenPanel !== panel.id && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => openEdit(panel.id)}
                      disabled={status === "generating" || runningAll}
                    >
                      부분 수정
                    </button>
                  )}
                </div>

                {state.candidate && editOpenPanel === panel.id && (
                  <div className="field" style={{ marginTop: 8 }}>
                    <label>수정 요청</label>
                    <textarea
                      className="textarea"
                      style={{ width: "100%", boxSizing: "border-box" }}
                      value={editInstructionByPanel[panel.id] ?? ""}
                      onChange={(e) =>
                        setEditInstructionByPanel((prev) => ({ ...prev, [panel.id]: e.target.value }))
                      }
                      maxLength={300}
                      placeholder="예: 노트북 뚜껑의 로고만 제거하고 나머지는 그대로 유지해주세요."
                      disabled={editingPanel === panel.id}
                    />
                    {editErrorByPanel[panel.id] && <p className="error">{editErrorByPanel[panel.id]}</p>}
                    <div className="form-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => handleEditOne(panel.id)}
                        disabled={editingPanel === panel.id || !(editInstructionByPanel[panel.id] ?? "").trim()}
                      >
                        {editingPanel === panel.id ? "수정 중..." : "수정 이미지 만들기"}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => cancelEdit(panel.id)}
                        disabled={editingPanel === panel.id}
                      >
                        취소
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <div className="card">
            {allApproved && panels[0] ? (
              <Link href={`/toon/projects/${panels[0].project_id}/editor`} className="btn btn-primary btn-block">
                말풍선 편집으로 이동
              </Link>
            ) : (
              <button
                type="button"
                className="btn btn-block"
                disabled
                title="모든 컷이 승인되어야 다음 단계로 진행할 수 있습니다"
              >
                말풍선 편집 (모든 컷 승인 필요)
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
