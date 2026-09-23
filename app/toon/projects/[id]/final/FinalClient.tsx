"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import type { FinalPanelView } from "../../../../../lib/projects/finalPage";
import { completeProjectAction, reopenProjectAction } from "../../../../../lib/projects/finalPage";
import { generateCaptionAction, saveCaptionAction, type CaptionView } from "../../../../../lib/projects/captions";
import { downloadAllFinalImagesAsZip, downloadSingleFinalImage } from "../../../../../lib/download/browserDownload";
import { buildPanelFileName } from "../../../../../lib/download/fileNaming";

export default function FinalClient({
  projectId,
  projectTitle,
  projectStatus,
  panels,
  readiness,
  initialCaption,
}: {
  projectId: string;
  projectTitle: string;
  projectStatus: string;
  panels: FinalPanelView[];
  readiness: { ready: boolean; errors: string[] };
  initialCaption: CaptionView | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(projectStatus);
  const [captionText, setCaptionText] = useState(initialCaption?.caption ?? "");
  const [hashtagsText, setHashtagsText] = useState((initialCaption?.hashtags ?? []).join(" "));
  const [hasSavedCaption, setHasSavedCaption] = useState(Boolean(initialCaption));
  const [generatingCaption, setGeneratingCaption] = useState(false);
  const [savingCaption, setSavingCaption] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isCompleted = status === "completed";

  async function handleEdit(panelNumber: number) {
    await reopenProjectAction(projectId);
    router.push(`/toon/projects/${projectId}/editor?panel=${panelNumber}`);
  }

  async function handleDownloadOne(panel: FinalPanelView, index: number) {
    if (!panel.finalSignedUrl) return;
    setMessage(null);
    try {
      await downloadSingleFinalImage(panel.finalSignedUrl, buildPanelFileName(index));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "다운로드에 실패했습니다.");
    }
  }

  async function handleDownloadAll() {
    setDownloadingAll(true);
    setMessage(null);
    try {
      const targets = panels
        .filter((p): p is FinalPanelView & { finalSignedUrl: string } => Boolean(p.finalSignedUrl))
        .map((p) => ({ panelNumber: p.panelNumber, signedUrl: p.finalSignedUrl }));
      await downloadAllFinalImagesAsZip(targets, projectTitle);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "전체 이미지 저장에 실패했습니다.");
    } finally {
      setDownloadingAll(false);
    }
  }

  async function handleGenerateCaption() {
    setGeneratingCaption(true);
    setMessage(null);
    try {
      const result = await generateCaptionAction(projectId);
      if (result.ok && result.caption && result.hashtags) {
        setCaptionText(result.caption);
        setHashtagsText(result.hashtags.join(" "));
        setMessage("새 캡션 후보가 만들어졌습니다. 확인 후 [캡션 저장]을 눌러주세요.");
      } else {
        setMessage(result.message ?? "캡션 생성에 실패했습니다. 기존 저장된 캡션은 그대로 있습니다.");
      }
    } finally {
      setGeneratingCaption(false);
    }
  }

  async function handleSaveCaption() {
    setSavingCaption(true);
    setMessage(null);
    try {
      const hashtags = hashtagsText.split(/\s+/).map((h) => h.trim()).filter(Boolean);
      const result = await saveCaptionAction(projectId, captionText, hashtags);
      if (result.ok) {
        setHasSavedCaption(true);
        setMessage("캡션이 저장되었습니다.");
      } else {
        setMessage(result.message ?? "캡션 저장에 실패했습니다.");
      }
    } finally {
      setSavingCaption(false);
    }
  }

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`${label} 복사했습니다.`);
    } catch {
      setMessage("복사에 실패했습니다.");
    }
  }

  async function handleComplete() {
    setCompleting(true);
    setMessage(null);
    try {
      const result = await completeProjectAction(projectId);
      if (result.ok) {
        setStatus("completed");
        setMessage("이 인스타툰을 완성했습니다!");
      } else {
        setMessage(result.message ?? "완료 처리에 실패했습니다.");
      }
    } finally {
      setCompleting(false);
    }
  }

  async function handleReopen() {
    const result = await reopenProjectAction(projectId);
    if (result.ok) {
      setStatus("confirmed");
      setMessage("다시 편집할 수 있습니다.");
    }
  }

  const hashtagsForCopy = hashtagsText
    .split(/\s+/)
    .map((h) => h.trim())
    .filter(Boolean)
    .join(" ");
  const fullCopyText = `${captionText}\n\n${hashtagsForCopy}`;

  return (
    <div>
      {isCompleted && (
        <div className="banner banner-success">
          이 프로젝트는 완성 처리되었습니다.{" "}
          <button type="button" className="btn" onClick={handleReopen}>
            다시 편집하기
          </button>
        </div>
      )}

      {!readiness.ready && (
        <div className="banner banner-error">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {readiness.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {message && <p className="hint">{message}</p>}

      <div className="final-grid">
        {panels.map((panel, index) => (
          <div className="card" key={panel.panelNumber}>
            <h3 style={{ fontSize: 14, marginTop: 0 }}>
              {panel.panelType === "cover" ? "표지" : `${panel.panelNumber - (panels[0]?.panelType === "cover" ? 1 : 0)}컷`}
            </h3>
            {panel.finalSignedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={panel.finalSignedUrl}
                alt={panel.panelType === "cover" ? "표지 최종 이미지" : `${panel.panelNumber}컷 최종 이미지`}
                style={{ width: "100%", borderRadius: 12, border: "1px solid var(--color-border)" }}
              />
            ) : (
              <p className="hint">아직 최종 이미지가 만들어지지 않았습니다.</p>
            )}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => handleEdit(panel.panelNumber)}>
                편집하기
              </button>
              {panel.finalSignedUrl && (
                <button type="button" className="btn" onClick={() => handleDownloadOne(panel, index)}>
                  PNG 저장
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={handleDownloadAll}
          disabled={!readiness.ready || downloadingAll}
          title={readiness.ready ? undefined : "모든 컷의 최종 이미지가 있어야 전체 저장할 수 있습니다."}
        >
          {downloadingAll ? "압축 중..." : "전체 이미지 저장 (ZIP)"}
        </button>
      </div>

      <h2 style={{ fontSize: 16 }}>인스타그램 캡션</h2>
      <div className="card">
        <div className="field">
          <label>캡션</label>
          <textarea className="textarea" rows={5} value={captionText} onChange={(e) => setCaptionText(e.target.value)} />
        </div>
        <div className="field">
          <label>해시태그 (공백으로 구분)</label>
          <textarea
            className="textarea"
            rows={2}
            value={hashtagsText}
            onChange={(e) => setHashtagsText(e.target.value)}
          />
        </div>

        <div className="form-actions">
          <button type="button" className="btn" onClick={handleGenerateCaption} disabled={generatingCaption}>
            {generatingCaption ? "만드는 중..." : hasSavedCaption ? "다시 만들기" : "인스타 캡션 만들기"}
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSaveCaption} disabled={savingCaption}>
            {savingCaption ? "저장 중..." : "캡션 저장"}
          </button>
        </div>

        <div className="form-actions">
          <button type="button" className="btn" onClick={() => copyToClipboard(captionText, "캡션")}>
            캡션 복사
          </button>
          <button type="button" className="btn" onClick={() => copyToClipboard(hashtagsForCopy, "해시태그")}>
            해시태그 복사
          </button>
          <button type="button" className="btn" onClick={() => copyToClipboard(fullCopyText, "전체")}>
            전체 복사
          </button>
        </div>
      </div>

      <div className="card">
        {!isCompleted ? (
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={handleComplete}
            disabled={!readiness.ready || completing}
            title={readiness.ready ? undefined : "아직 최종 이미지가 만들어지지 않은 컷이 있어요."}
          >
            {completing ? "처리 중..." : "이 인스타툰 완성"}
          </button>
        ) : (
          <Link href="/toon/projects" className="btn btn-block">
            프로젝트 목록으로
          </Link>
        )}
      </div>
    </div>
  );
}
