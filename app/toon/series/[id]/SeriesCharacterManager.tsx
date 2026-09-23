"use client";

import { useState, useTransition } from "react";
import { linkCharacterToSeriesAction, unlinkCharacterFromSeriesAction } from "../../../../lib/series/actions";

interface CharacterOption {
  id: string;
  display_name: string;
  role: string;
}

export default function SeriesCharacterManager({
  seriesId,
  allCharacters,
  initialLinkedIds,
}: {
  seriesId: string;
  allCharacters: CharacterOption[];
  initialLinkedIds: string[];
}) {
  const [linkedIds, setLinkedIds] = useState<string[]>(initialLinkedIds);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(characterId: string) {
    setError(null);
    setPendingId(characterId);
    const isLinked = linkedIds.includes(characterId);
    startTransition(async () => {
      const result = isLinked
        ? await unlinkCharacterFromSeriesAction(seriesId, characterId)
        : await linkCharacterToSeriesAction(seriesId, characterId);
      if (result.ok) {
        setLinkedIds((prev) => (isLinked ? prev.filter((id) => id !== characterId) : [...prev, characterId]));
      } else {
        setError(result.message ?? "처리에 실패했습니다.");
      }
      setPendingId(null);
    });
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: 15, marginTop: 0 }}>시리즈 등장인물 (Character Set)</h2>
      {error && <p className="error">{error}</p>}
      {allCharacters.length === 0 ? (
        <p className="hint">등록된 캐릭터가 없습니다. 먼저 캐릭터를 만들어주세요.</p>
      ) : (
        allCharacters.map((c) => (
          <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
            <input
              type="checkbox"
              checked={linkedIds.includes(c.id)}
              onChange={() => toggle(c.id)}
              disabled={pendingId === c.id}
            />
            <span>
              {c.display_name} <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>({c.role})</span>
            </span>
          </label>
        ))
      )}
    </div>
  );
}
