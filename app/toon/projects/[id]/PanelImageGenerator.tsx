"use client";

import { useState } from "react";
import Link from "next/link";
import {
  approvePanelImageAction,
  generatePanelImageAction,
  type PanelImageView,
} from "../../../../lib/projects/panelImages";
import type { ToonPanel } from "../../../../src/db/types";

interface PanelImagesState {
  approved?: PanelImageView;
  candidate?: PanelImageView;
}

export default function PanelImageGenerator({
  panels,
  initialImages,
  initialReadinessErrors,
}: {
  panels: ToonPanel[];
  initialImages: Record<string, PanelImagesState>;
  initialReadinessErrors: string[];
}) {
  const [images, setImages] = useState<Record<string, PanelImagesState>>(initialImages);
  const [statusByPanel, setStatusByPanel] = useState<Record<string, "idle" | "generating" | "failed">>({});
  const [errorByPanel, setErrorByPanel] = useState<Record<string, string>>({});
  const [runningAll, setRunningAll] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [readinessErrors] = useState(initialReadinessErrors);

  const approvedCount = panels.filter((p) => images[p.id]?.approved).length;
  const allApproved = panels.length > 0 && approvedCount === panels.length;

  async function generateOne(panelId: string): Promise<boolean> {
    setStatusByPanel((prev) => ({ ...prev, [panelId]: "generating" }));
    setErrorByPanel((prev) => {
      const next = { ...prev };
      delete next[panelId];
      return next;
    });

    const result = await generatePanelImageAction(panelId);
    if (result.ok && result.image) {
      setImages((prev) => ({ ...prev, [panelId]: { ...prev[panelId], candidate: result.image } }));
      setStatusByPanel((prev) => ({ ...prev, [panelId]: "idle" }));
      return true;
    }

    setStatusByPanel((prev) => ({ ...prev, [panelId]: "failed" }));
    setErrorByPanel((prev) => ({ ...prev, [panelId]: result.message ?? "생성에 실패했습니다." }));
    return false;
  }

  async function handleGenerateAll() {
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

            return (
              <div className="card" key={panel.id}>
                <h3 style={{ fontSize: 14, marginTop: 0 }}>컷 {panel.panel_number}</h3>
                <p className="hint" style={{ marginTop: 0 }}>
                  {panel.scene}
                </p>
                <p className="hint">
                  상태:{" "}
                  {status === "generating"
                    ? "생성 중..."
                    : state.approved
                      ? "승인됨"
                      : state.candidate
                        ? "후보"
                        : status === "failed"
                          ? "실패"
                          : "대기"}
                </p>

                {error && <p className="error">{error}</p>}

                {(state.approved ?? state.candidate)?.signedUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={(state.approved ?? state.candidate)!.signedUrl!}
                    alt=""
                    style={{ width: "100%", borderRadius: 12, border: "1px solid var(--color-border)" }}
                  />
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
                </div>
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
