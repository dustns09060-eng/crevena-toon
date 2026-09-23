"use client";

import { useState, useTransition } from "react";
import { deleteProjectAction } from "../../../lib/projects/actions";

export default function DeleteProjectButton({
  projectId,
  projectTitle,
}: {
  projectId: string;
  projectTitle: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleClick() {
    if (!window.confirm(`'${projectTitle}' 프로젝트를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    setMessage(null);
    startTransition(async () => {
      const result = await deleteProjectAction(projectId);
      if (!result.ok) setMessage(result.message ?? "삭제할 수 없습니다.");
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
