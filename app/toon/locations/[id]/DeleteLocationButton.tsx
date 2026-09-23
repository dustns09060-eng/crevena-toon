"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteLocationAction } from "../../../../lib/locations/actions";

export default function DeleteLocationButton({ locationId, locationName }: { locationId: string; locationName: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    if (!window.confirm(`'${locationName}' 장소를 삭제할까요? 이 장소를 쓰는 시리즈 연결도 함께 해제됩니다.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteLocationAction(locationId);
      if (result.ok) {
        router.push("/toon/locations");
      } else {
        setError(result.message ?? "삭제에 실패했습니다.");
      }
    });
  }

  return (
    <div>
      {error && <p className="error">{error}</p>}
      <button type="button" className="btn" onClick={handleDelete} disabled={pending}>
        {pending ? "삭제 중..." : "삭제"}
      </button>
    </div>
  );
}
