"use client";

import { useRef, useState, useTransition } from "react";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  MAX_PHOTOS,
} from "../../../../lib/characters/photoValidation";
import {
  deleteReferenceAction,
  setPrimaryReferenceAction,
  uploadReferenceAction,
} from "../../../../lib/characters/actions";

export interface ReferenceItem {
  id: string;
  isPrimary: boolean;
  signedUrl: string | null;
}

export default function ReferenceGallery({
  characterId,
  initialReferences,
}: {
  characterId: string;
  initialReferences: ReferenceItem[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const count = initialReferences.length;

  function handleUpload(file: File | undefined) {
    if (!file) return;
    setMessage(null);

    if (!ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
      setMessage("JPG, PNG, WEBP 형식만 업로드할 수 있습니다.");
      return;
    }
    if (file.size === 0) {
      setMessage("빈 파일은 업로드할 수 없습니다.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setMessage("파일 크기는 8MB를 초과할 수 없습니다.");
      return;
    }
    if (count >= MAX_PHOTOS) {
      setMessage(`사진은 최대 ${MAX_PHOTOS}장까지 업로드할 수 있습니다.`);
      return;
    }

    const formData = new FormData();
    formData.set("photo", file);
    startTransition(async () => {
      const result = await uploadReferenceAction(characterId, formData);
      if (!result.ok) setMessage(result.message ?? "업로드에 실패했습니다.");
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  function handleDelete(referenceId: string) {
    if (!window.confirm("이 사진을 삭제할까요?")) return;
    setMessage(null);
    startTransition(async () => {
      const result = await deleteReferenceAction(characterId, referenceId);
      if (!result.ok) setMessage(result.message ?? "삭제할 수 없습니다.");
    });
  }

  function handleSetPrimary(referenceId: string) {
    setMessage(null);
    startTransition(async () => {
      await setPrimaryReferenceAction(characterId, referenceId);
    });
  }

  return (
    <div>
      <p className="upload-note">
        얼굴이 잘 보이고 다른 사람이 적게 나온 사진일수록 캐릭터를 더 일관되게 만들 수 있어요. (최소 1장,
        최대 {MAX_PHOTOS}장)
      </p>

      <div className="photo-grid">
        {initialReferences.map((r) => (
          <div className="photo-tile" key={r.id}>
            {r.signedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.signedUrl} alt="" />
            ) : (
              <div style={{ width: "100%", height: "100%", background: "var(--color-bg)" }} />
            )}
            {r.isPrimary && <span className="photo-tile__badge">대표</span>}
            <div className="photo-tile__actions">
              {!r.isPrimary && (
                <button type="button" disabled={pending} onClick={() => handleSetPrimary(r.id)}>
                  대표로
                </button>
              )}
              <button type="button" disabled={pending} onClick={() => handleDelete(r.id)}>
                삭제
              </button>
            </div>
          </div>
        ))}

        {count < MAX_PHOTOS && (
          <label
            className="photo-tile"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <span style={{ fontSize: 24, color: "var(--color-text-muted)" }}>+</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: "none" }}
              disabled={pending}
              onChange={(e) => handleUpload(e.target.files?.[0])}
            />
          </label>
        )}
      </div>

      {message && <p className="error">{message}</p>}
    </div>
  );
}
