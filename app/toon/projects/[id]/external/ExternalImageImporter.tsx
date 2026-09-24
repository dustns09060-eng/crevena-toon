"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "../../../../../lib/supabase/client";
import { cancelExternalUploadAction, finishExternalUploadAction, prepareExternalUploadAction } from "../../../../../lib/projects/externalImages";
import { uploadExternalBatch } from "../../../../../lib/projects/externalUploadFlow";
import { EXTERNAL_IMAGE_COUNT, externalImageLabel, reorderExternalImages, sortExternalImages, validateExternalImageFile, validateExternalImageFiles } from "../../../../../lib/projects/externalImageUtils";

type Selection = { file: File; url: string; key: string };

export default function ExternalImageImporter({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<Selection[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceIndex = useRef<number | null>(null);
  const dragIndex = useRef<number | null>(null);
  const busyRef = useRef(false);
  const urls = useRef(new Set<string>());
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); }, []);

  function selection(file: File): Selection {
    const url = URL.createObjectURL(file);
    urls.current.add(url);
    return { file, url, key: crypto.randomUUID() };
  }
  function release(item: Selection) {
    URL.revokeObjectURL(item.url);
    urls.current.delete(item.url);
  }
  function handleSelect(files: FileList | null) {
    if (!files) return;
    if (files.length > EXTERNAL_IMAGE_COUNT) { setMessage("최대 11장만 선택할 수 있습니다."); return; }
    const selected = sortExternalImages(Array.from(files));
    const error = selected.find((file) => validateExternalImageFile(file));
    if (error) { setMessage(`이미지 형식 또는 크기를 확인해주세요: ${error.name}`); return; }
    items.forEach(release);
    setItems(selected.map(selection));
    setMessage(selected.length < EXTERNAL_IMAGE_COUNT ? "11장을 모두 선택한 뒤 가져올 수 있습니다." : null);
  }
  function handleReplace(files: FileList | null) {
    const index = replaceIndex.current;
    const file = files?.[0];
    if (index === null || !file) return;
    const error = validateExternalImageFile(file);
    if (error) { setMessage(error); return; }
    if (items[index]) release(items[index]);
    const next = [...items];
    next[index] = selection(file);
    setItems(next);
    setMessage(null);
  }
  function move(from: number, to: number) {
    setItems((prev) => reorderExternalImages(prev, from, to));
  }
  async function confirm() {
    if (busyRef.current) return;
    const error = validateExternalImageFiles(items.map((item) => item.file));
    if (error) { setMessage(error); return; }
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const prepared = await prepareExternalUploadAction(projectId, items.map(({ file }) => ({ name: file.name, size: file.size, type: file.type })));
      if (!prepared.ok || !prepared.uploads) { setMessage(prepared.message ?? "업로드를 시작할 수 없습니다."); return; }
      const bucket = createClient().storage.from("toon-panels");
      await uploadExternalBatch(prepared.uploads,
        async (upload, index) => {
          const { error: uploadError } = await bucket.uploadToSignedUrl(upload.path, upload.token, items[index].file, {
            contentType: items[index].file.type, upsert: false,
          });
          if (uploadError) throw new Error(`${externalImageLabel(index)} 업로드에 실패했습니다.`);
        },
        async (paths) => {
          const result = await finishExternalUploadAction(projectId, paths);
          if (!result.ok) throw new Error(result.message ?? "이미지 저장에 실패했습니다.");
        },
        async (paths) => {
          const cleaned = await cancelExternalUploadAction(projectId, paths);
          if (!cleaned.ok) throw new Error(cleaned.message ?? "업로드 파일 정리에 실패했습니다.");
        });
      setDone(true);
      setMessage("11장 가져오기가 완료되었습니다. Editor에서 제목과 대사를 입력하세요.");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "업로드에 실패했습니다.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 740, width: "100%", boxSizing: "border-box" }}>
      <p>텍스트 없는 이미지 11장을 선택하세요. 확인 전에는 서버에 저장되지 않습니다.</p>
      <input ref={inputRef} type="file" accept=".png,.jpg,.jpeg,.webp" multiple hidden onChange={(e) => { handleSelect(e.target.files); e.target.value = ""; }} />
      <input ref={replaceRef} type="file" accept=".png,.jpg,.jpeg,.webp" hidden onChange={(e) => { handleReplace(e.target.files); e.target.value = ""; }} />
      <button type="button" className="btn" disabled={busy || done} onClick={() => inputRef.current?.click()}>이미지 11장 선택</button>
      <p className="hint">{items.length}/11장 · 1장당 최대 10MB · 목록을 끌어서 순서를 바꾸거나 이동 버튼을 누르세요.</p>
      {message && <p role="status" className="hint">{message}</p>}
      <div style={{ display: "grid", gap: 10 }}>
        {items.map((item, index) => (
          <div key={item.key} draggable={!busy && !done} onDragStart={() => { dragIndex.current = index; }}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (dragIndex.current !== null) move(dragIndex.current, index); dragIndex.current = null; }}
            style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flexWrap: "wrap", padding: 8, border: "1px solid #ddd", borderRadius: 8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.url} alt={`${externalImageLabel(index)} 미리보기`} style={{ width: 60, height: 75, objectFit: "contain" }} />
            <div style={{ minWidth: 0, flex: "1 1 120px" }}><strong>{externalImageLabel(index)}</strong><div style={{ overflowWrap: "anywhere" }}>{item.file.name}</div></div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <button type="button" className="btn" disabled={busy || done || index === 0} onClick={() => move(index, index - 1)} aria-label={`${externalImageLabel(index)} 위로 이동`}>↑</button>
              <button type="button" className="btn" disabled={busy || done || index === items.length - 1} onClick={() => move(index, index + 1)} aria-label={`${externalImageLabel(index)} 아래로 이동`}>↓</button>
              <button type="button" className="btn" disabled={busy || done} onClick={() => { replaceIndex.current = index; replaceRef.current?.click(); }}>교체</button>
              <button type="button" className="btn" disabled={busy || done} onClick={() => { release(item); setItems((prev) => prev.filter((p) => p.key !== item.key)); }}>제거</button>
            </div>
          </div>
        ))}
      </div>
      <div className="form-actions" style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href={`/toon/projects/${projectId}`} className="btn">취소</Link>
        {!done ? <button type="button" className="btn btn-primary" disabled={busy || items.length !== 11} onClick={confirm}>{busy ? "업로드 중..." : "11장 가져오기"}</button> :
          <Link href={`/toon/projects/${projectId}/editor`} className="btn btn-primary">대사/내레이션 편집하기</Link>}
      </div>
    </div>
  );
}
