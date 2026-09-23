"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  MAX_PHOTOS,
  MIN_PHOTOS,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
} from "../../../../lib/characters/photoValidation";
import { createCharacterAction, type ActionState } from "../../../../lib/characters/actions";

const initialState: ActionState = { ok: true };

interface PickedPhoto {
  file: File;
  previewUrl: string;
}

export default function NewCharacterForm() {
  const [state, formAction, pending] = useActionState(createCharacterAction, initialState);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canAddMore = photos.length < MAX_PHOTOS;

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setPhotoError(null);

    const incoming = Array.from(fileList);
    const room = MAX_PHOTOS - photos.length;
    const toAdd = incoming.slice(0, room);
    if (incoming.length > room) {
      setPhotoError(`사진은 최대 ${MAX_PHOTOS}장까지 업로드할 수 있습니다.`);
    }

    const rejected: string[] = [];
    const accepted: PickedPhoto[] = [];
    for (const file of toAdd) {
      if (!ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
        rejected.push(`${file.type || "알 수 없는 형식"} 형식은 지원하지 않습니다`);
        continue;
      }
      if (file.size === 0) {
        rejected.push("빈 파일은 업로드할 수 없습니다");
        continue;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        rejected.push(`${file.name.slice(0, 20)} 파일이 너무 큽니다 (최대 8MB)`);
        continue;
      }
      accepted.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    if (rejected.length > 0) {
      setPhotoError(rejected[0]);
    }
    setPhotos((prev) => [...prev, ...accepted]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePhoto(index: number) {
    setPhotos((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  }

  const hiddenPhotosInputRef = useRef<HTMLInputElement>(null);

  // DataTransfer는 브라우저 전용 API라 SSR 중에는 존재하지 않는다 —
  // 렌더링 중(useMemo)이 아니라 커밋 이후(useEffect)에만 다뤄야 한다.
  useEffect(() => {
    if (!hiddenPhotosInputRef.current || typeof DataTransfer === "undefined") return;
    const dt = new DataTransfer();
    for (const p of photos) dt.items.add(p.file);
    hiddenPhotosInputRef.current.files = dt.files;
  }, [photos]);

  return (
    <form action={formAction}>
      {!state.ok && state.message && <div className="banner banner-error">{state.message}</div>}

      <div className="field">
        <label htmlFor="display_name">캐릭터 이름 *</label>
        <input
          id="display_name"
          name="display_name"
          className="input"
          placeholder="예: 엄마, 첫째, 둘째, 아빠, 반려견 콩이"
          required
          maxLength={50}
        />
        {state.errors?.display_name && <p className="error">{state.errors.display_name}</p>}
      </div>

      <div className="field">
        <label htmlFor="role">역할 *</label>
        <input
          id="role"
          name="role"
          className="input"
          placeholder="예: 주인공 엄마, 첫째 아들, 반려동물"
          required
          maxLength={50}
        />
        {state.errors?.role && <p className="error">{state.errors.role}</p>}
      </div>

      <div className="field">
        <label htmlFor="personality">성격 (선택)</label>
        <textarea id="personality" name="personality" className="textarea" maxLength={500} />
      </div>

      <div className="field">
        <label htmlFor="speaking_style">말투 (선택)</label>
        <textarea id="speaking_style" name="speaking_style" className="textarea" maxLength={500} />
      </div>

      <div className="field">
        <label htmlFor="representative_outfit">대표 의상 메모 (선택)</label>
        <textarea
          id="representative_outfit"
          name="representative_outfit"
          className="textarea"
          placeholder="예: 검은색 스트라이프 티셔츠"
          maxLength={500}
        />
      </div>

      <div className="field">
        <label>참조 사진 * (최소 1장, 최대 {MAX_PHOTOS}장)</label>
        <p className="upload-note">
          얼굴이 잘 보이고 다른 사람이 적게 나온 사진일수록 캐릭터를 더 일관되게 만들 수 있어요.
        </p>

        <div className="photo-grid">
          {photos.map((p, i) => (
            <div className="photo-tile" key={p.previewUrl}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.previewUrl} alt="" />
              {i === 0 && <span className="photo-tile__badge">대표</span>}
              <div className="photo-tile__actions">
                <button type="button" onClick={() => removePhoto(i)}>
                  삭제
                </button>
              </div>
            </div>
          ))}
          {canAddMore && (
            <label
              className="photo-tile"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <span style={{ fontSize: 24, color: "var(--color-text-muted)" }}>+</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                style={{ display: "none" }}
                onChange={(e) => handleFiles(e.target.files)}
              />
            </label>
          )}
        </div>
        {photoError && <p className="error">{photoError}</p>}

        {/* 실제 제출용 hidden file input — 선택된 파일들을 useEffect로 동기화한다 */}
        <input type="file" name="photos" multiple hidden ref={hiddenPhotosInputRef} />
      </div>

      <div className="form-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending || photos.length < MIN_PHOTOS}
        >
          {pending ? "저장 중..." : "캐릭터 만들기"}
        </button>
      </div>
    </form>
  );
}
