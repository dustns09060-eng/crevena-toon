"use client";

import { useState, useTransition } from "react";
import {
  approveCharacterSheetAction,
  generateCharacterSheetAction,
  type CharacterSheetView,
} from "../../../../lib/characters/characterSheet";

export default function CharacterSheetSection({
  characterId,
  initialApproved,
  initialCandidate,
}: {
  characterId: string;
  initialApproved: CharacterSheetView | null;
  initialCandidate: CharacterSheetView | null;
}) {
  const [approved, setApproved] = useState(initialApproved);
  const [candidate, setCandidate] = useState(initialCandidate);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [generating, startGenerating] = useTransition();
  const [approving, startApproving] = useTransition();

  const busy = generating || approving;

  function handleGenerate() {
    setErrorMessage(null);
    startGenerating(async () => {
      const result = await generateCharacterSheetAction(characterId);
      if (result.ok && result.sheet) {
        setCandidate(result.sheet); // 실패 없이 성공했을 때만 candidate를 교체 — approved는 그대로 유지
      } else {
        setErrorMessage(result.message ?? "Character Sheet 생성에 실패했습니다.");
      }
    });
  }

  function handleApprove() {
    if (!candidate) return;
    setErrorMessage(null);
    startApproving(async () => {
      const result = await approveCharacterSheetAction(characterId, candidate.id);
      if (result.ok) {
        setApproved({ ...candidate, status: "approved" });
        setCandidate(null);
      } else {
        setErrorMessage(result.message ?? "승인에 실패했습니다.");
      }
    });
  }

  const hasAny = approved || candidate;

  return (
    <div>
      {errorMessage && <div className="banner banner-error">{errorMessage}</div>}

      {generating && <p className="upload-note">캐릭터 기준 이미지를 만들고 있어요...</p>}

      {!hasAny && !generating && (
        <>
          <p className="hint">아직 캐릭터 기준 이미지가 없어요.</p>
          <button type="button" className="btn btn-primary btn-block" onClick={handleGenerate} disabled={busy}>
            Character Sheet 만들기
          </button>
        </>
      )}

      {approved && (
        <div style={{ marginBottom: 16 }}>
          <p className="hint">현재 사용 중인 Character Sheet (v{approved.generationVersion})</p>
          {approved.signedUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={approved.signedUrl}
              alt=""
              style={{ width: "100%", borderRadius: 12, border: "1px solid var(--color-border)" }}
            />
          )}
        </div>
      )}

      {candidate && (
        <div style={{ marginBottom: 16 }}>
          <div className="banner banner-error" style={{ background: "#fff6e5", borderColor: "#d69b1f", color: "#8a5b00" }}>
            새로 생성된 후보입니다 (v{candidate.generationVersion}). 확인 후 사용 여부를 결정해주세요.
          </div>
          {candidate.signedUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={candidate.signedUrl}
              alt=""
              style={{ width: "100%", borderRadius: 12, border: "1px solid var(--color-border)" }}
            />
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={handleApprove} disabled={busy}>
              {approving ? "적용 중..." : "이 Character Sheet 사용"}
            </button>
          </div>
        </div>
      )}

      {hasAny && !generating && (
        <button type="button" className="btn btn-block" onClick={handleGenerate} disabled={busy}>
          다시 만들기
        </button>
      )}
    </div>
  );
}
