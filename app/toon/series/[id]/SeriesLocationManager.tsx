"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { linkLocationToSeriesAction, unlinkLocationFromSeriesAction } from "../../../../lib/series/actions";

interface LocationOption {
  id: string;
  display_name: string;
  visual_prompt: string;
}

export default function SeriesLocationManager({
  seriesId,
  allLocations,
  initialLinkedIds,
}: {
  seriesId: string;
  allLocations: LocationOption[];
  initialLinkedIds: string[];
}) {
  const [linkedIds, setLinkedIds] = useState<string[]>(initialLinkedIds);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(locationId: string) {
    setError(null);
    setPendingId(locationId);
    const isLinked = linkedIds.includes(locationId);
    startTransition(async () => {
      const result = isLinked
        ? await unlinkLocationFromSeriesAction(seriesId, locationId)
        : await linkLocationToSeriesAction(seriesId, locationId);
      if (result.ok) {
        setLinkedIds((prev) => (isLinked ? prev.filter((id) => id !== locationId) : [...prev, locationId]));
      } else {
        setError(result.message ?? "처리에 실패했습니다.");
      }
      setPendingId(null);
    });
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: 15, marginTop: 0 }}>시리즈 장소 (Location Set)</h2>
      {error && <p className="error">{error}</p>}
      {allLocations.length === 0 ? (
        <p className="hint">
          등록된 장소가 없습니다. 먼저 <Link href="/toon/locations/new">장소를 만들어주세요</Link>.
        </p>
      ) : (
        allLocations.map((l) => (
          <label key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
            <input
              type="checkbox"
              checked={linkedIds.includes(l.id)}
              onChange={() => toggle(l.id)}
              disabled={pendingId === l.id}
            />
            <span>
              {l.display_name}{" "}
              <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>({l.visual_prompt})</span>
            </span>
          </label>
        ))
      )}
    </div>
  );
}
