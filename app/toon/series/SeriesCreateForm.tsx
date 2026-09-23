"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createSeriesAction } from "../../../lib/series/actions";

export default function SeriesCreateForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createSeriesAction(title);
      if (result.ok && result.series) {
        router.push(`/toon/series/${result.series.id}`);
      } else {
        setError(result.message ?? "시리즈 생성에 실패했습니다.");
      }
    });
  }

  return (
    <div className="field">
      <label htmlFor="new-series-title">새 시리즈 만들기</label>
      <input
        id="new-series-title"
        className="input"
        placeholder="예: 유별맘"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={80}
      />
      {error && <p className="error">{error}</p>}
      <button type="button" className="btn btn-primary btn-block" onClick={handleCreate} disabled={pending} style={{ marginTop: 8 }}>
        {pending ? "만드는 중..." : "시리즈 만들기"}
      </button>
    </div>
  );
}
