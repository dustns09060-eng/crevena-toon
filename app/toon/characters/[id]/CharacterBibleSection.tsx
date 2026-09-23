"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { analyzeCharacterAction, saveCharacterBibleAction } from "../../../../lib/characters/analysis";
import type { CharacterBibleAnalysisParsed } from "../../../../src/providers/characterAnalysisSchema";
import type { ToonCharacter } from "../../../../src/db/types";

function fromCharacter(character: ToonCharacter): CharacterBibleAnalysisParsed | null {
  if (!character.hairstyle) return null;
  return {
    hairstyle: character.hairstyle,
    hair_color: character.hair_color ?? "",
    face_features: character.face_features ?? "",
    body_type: character.body_type ?? "",
    representative_outfit: character.representative_outfit ?? "",
    distinctive_features: character.distinctive_features,
    visual_prompt: character.visual_prompt,
    negative_constraints:
      character.negative_constraints && character.negative_constraints.length > 0
        ? character.negative_constraints
        : [""],
  };
}

export default function CharacterBibleSection({
  characterId,
  character,
}: {
  characterId: string;
  character: ToonCharacter;
}) {
  const router = useRouter();
  const [bible, setBible] = useState<CharacterBibleAnalysisParsed | null>(() => fromCharacter(character));
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [analyzing, startAnalyzing] = useTransition();
  const [saving, startSaving] = useTransition();

  function handleAnalyze() {
    setErrorMessage(null);
    startAnalyzing(async () => {
      const result = await analyzeCharacterAction(characterId);
      if (result.ok && result.result) {
        setBible(result.result);
        setHasUnsaved(true);
      } else {
        setErrorMessage(result.message ?? "분석에 실패했습니다.");
        // 실패 시 기존 bible 상태는 건드리지 않는다 (요구사항: 실패하면 기존 데이터 유지)
      }
    });
  }

  function handleSave() {
    if (!bible) return;
    setErrorMessage(null);
    startSaving(async () => {
      const result = await saveCharacterBibleAction(characterId, bible);
      if (result.ok) {
        setHasUnsaved(false);
        router.refresh();
      } else {
        setErrorMessage(result.message ?? "저장에 실패했습니다.");
      }
    });
  }

  function updateField<K extends keyof CharacterBibleAnalysisParsed>(
    key: K,
    value: CharacterBibleAnalysisParsed[K]
  ) {
    setBible((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  const busy = analyzing || saving;

  return (
    <div>
      {errorMessage && <div className="banner banner-error">{errorMessage}</div>}

      {analyzing && <p className="upload-note">캐릭터 특징을 분석하고 있어요...</p>}

      {!bible && !analyzing && (
        <button type="button" className="btn btn-primary btn-block" onClick={handleAnalyze} disabled={busy}>
          사진으로 캐릭터 분석하기
        </button>
      )}

      {bible && (
        <div>
          {hasUnsaved && (
            <div className="banner banner-error" style={{ background: "#fff6e5", borderColor: "#d69b1f", color: "#8a5b00" }}>
              아직 저장하지 않은 분석 결과입니다. 확인 후 저장해주세요.
            </div>
          )}

          <div className="field">
            <label htmlFor="bible-hairstyle">헤어스타일</label>
            <input
              id="bible-hairstyle"
              className="input"
              value={bible.hairstyle}
              maxLength={200}
              onChange={(e) => updateField("hairstyle", e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="field">
            <label htmlFor="bible-hair-color">머리색</label>
            <input
              id="bible-hair-color"
              className="input"
              value={bible.hair_color}
              maxLength={100}
              onChange={(e) => updateField("hair_color", e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="field">
            <label htmlFor="bible-face">얼굴 특징</label>
            <textarea
              id="bible-face"
              className="textarea"
              value={bible.face_features}
              maxLength={300}
              onChange={(e) => updateField("face_features", e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="field">
            <label htmlFor="bible-body">체형</label>
            <input
              id="bible-body"
              className="input"
              value={bible.body_type}
              maxLength={200}
              onChange={(e) => updateField("body_type", e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="field">
            <label htmlFor="bible-outfit">대표 의상</label>
            <input
              id="bible-outfit"
              className="input"
              value={bible.representative_outfit}
              maxLength={200}
              onChange={(e) => updateField("representative_outfit", e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="field">
            <label htmlFor="bible-distinctive">특징적인 요소 (선택)</label>
            <input
              id="bible-distinctive"
              className="input"
              value={bible.distinctive_features ?? ""}
              maxLength={300}
              onChange={(e) => updateField("distinctive_features", e.target.value || null)}
              disabled={busy}
            />
          </div>

          <div className="field">
            <label htmlFor="bible-prompt">Character Prompt</label>
            <textarea
              id="bible-prompt"
              className="textarea"
              value={bible.visual_prompt}
              maxLength={800}
              onChange={(e) => updateField("visual_prompt", e.target.value)}
              disabled={busy}
            />
            <p className="hint">향후 이미지 생성 시 캐릭터를 일관되게 유지하기 위해 사용되는 고정 묘사입니다.</p>
          </div>

          <div className="field">
            <label htmlFor="bible-negative">지켜야 할 규칙 (한 줄에 하나씩)</label>
            <textarea
              id="bible-negative"
              className="textarea"
              value={bible.negative_constraints.join("\n")}
              onChange={(e) =>
                updateField(
                  "negative_constraints",
                  e.target.value.split("\n")
                )
              }
              disabled={busy}
            />
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={busy}>
              {saving ? "저장 중..." : "저장"}
            </button>
            <button type="button" className="btn" onClick={handleAnalyze} disabled={busy}>
              {analyzing ? "분석 중..." : "다시 분석하기"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
