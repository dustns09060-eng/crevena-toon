"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteCharacterAction } from "../../../lib/characters/actions";

export default function DeleteCharacterButton({
  characterId,
  characterName,
  redirectOnSuccess,
}: {
  characterId: string;
  characterName: string;
  /** 삭제 성공 시 이동할 경로 (상세 페이지에서 사용, 목록에서는 생략) */
  redirectOnSuccess?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleClick() {
    if (!window.confirm(`'${characterName}' 캐릭터를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) {
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await deleteCharacterAction(characterId);
      if (!result.ok) {
        setMessage(result.message ?? "삭제할 수 없습니다.");
      } else if (redirectOnSuccess) {
        router.push(redirectOnSuccess);
      }
    });
  }

  return (
    <div className="delete-char-btn">
      <button type="button" className="btn btn-danger" onClick={handleClick} disabled={pending}>
        {pending ? "삭제 중..." : "삭제"}
      </button>
      {message && <p className="delete-char-btn__error">{message}</p>}
    </div>
  );
}
