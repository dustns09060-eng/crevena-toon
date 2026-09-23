"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../supabase/server";
import { validateCharacterForm } from "./formValidation";
import * as characterService from "./service";
import {
  uploadReferenceImage,
  deleteReference as deleteReferenceRow,
  setPrimaryReference as setPrimaryReferenceRow,
} from "./references";
import { MIN_PHOTOS, validatePhotoCount } from "./photoValidation";

export interface ActionState {
  ok: boolean;
  errors?: Record<string, string>;
  message?: string;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");
  return { supabase, user };
}

function readCharacterForm(formData: FormData) {
  return {
    display_name: String(formData.get("display_name") ?? ""),
    role: String(formData.get("role") ?? ""),
    personality: String(formData.get("personality") ?? ""),
    speaking_style: String(formData.get("speaking_style") ?? ""),
    representative_outfit: String(formData.get("representative_outfit") ?? ""),
  };
}

export async function createCharacterAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase, user } = await requireUser();

  const validation = validateCharacterForm(readCharacterForm(formData));
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }

  const files = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  const countCheck = validatePhotoCount(files.length);
  if (!countCheck.valid) {
    return { ok: false, message: countCheck.reason };
  }

  const character = await characterService.createCharacter(supabase, validation.data);

  let primarySet = false;
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      await uploadReferenceImage(supabase, user.id, character.id, {
        bytes,
        declaredMimeType: file.type,
        size: file.size,
        isPrimary: !primarySet,
      });
      primarySet = true;
    } catch (e) {
      return {
        ok: false,
        message:
          (e instanceof Error ? e.message : "사진 업로드 중 오류가 발생했습니다.") +
          " (캐릭터 정보는 저장됐습니다 — 상세 페이지에서 사진을 다시 추가해주세요.)",
      };
    }
  }

  revalidatePath("/toon/characters");
  redirect(`/toon/characters/${character.id}`);
}

export async function updateCharacterAction(
  characterId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase } = await requireUser();

  const validation = validateCharacterForm(readCharacterForm(formData));
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }

  await characterService.updateCharacter(supabase, characterId, validation.data);

  revalidatePath(`/toon/characters/${characterId}`);
  revalidatePath("/toon/characters");
  return { ok: true };
}

export async function deleteCharacterAction(
  characterId: string
): Promise<{ ok: boolean; message?: string }> {
  const { supabase } = await requireUser();

  const result = await characterService.deleteCharacter(supabase, characterId);
  if (!result.deleted) {
    return {
      ok: false,
      message: `이 캐릭터는 ${result.projectCount}개의 프로젝트에서 사용 중이라 삭제할 수 없습니다. 먼저 프로젝트 연결을 해제해주세요.`,
    };
  }

  revalidatePath("/toon/characters");
  return { ok: true };
}

export async function uploadReferenceAction(
  characterId: string,
  formData: FormData
): Promise<{ ok: boolean; message?: string }> {
  const { supabase, user } = await requireUser();

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "사진 파일을 선택해주세요." };
  }

  const existing = await characterService.listReferences(supabase, characterId);
  const countCheck = validatePhotoCount(existing.length + 1);
  if (!countCheck.valid) {
    return { ok: false, message: countCheck.reason };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    await uploadReferenceImage(supabase, user.id, characterId, {
      bytes,
      declaredMimeType: file.type,
      size: file.size,
      isPrimary: existing.length === 0,
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "업로드 중 오류가 발생했습니다." };
  }

  revalidatePath(`/toon/characters/${characterId}`);
  return { ok: true };
}

export async function deleteReferenceAction(
  characterId: string,
  referenceId: string
): Promise<{ ok: boolean; message?: string }> {
  const { supabase } = await requireUser();

  const existing = await characterService.listReferences(supabase, characterId);
  if (existing.length <= MIN_PHOTOS) {
    return { ok: false, message: "최소 1장의 사진은 남아있어야 합니다." };
  }

  await deleteReferenceRow(supabase, characterId, referenceId);
  revalidatePath(`/toon/characters/${characterId}`);
  return { ok: true };
}

export async function setPrimaryReferenceAction(
  characterId: string,
  referenceId: string
): Promise<{ ok: boolean }> {
  const { supabase } = await requireUser();
  await setPrimaryReferenceRow(supabase, characterId, referenceId);
  revalidatePath(`/toon/characters/${characterId}`);
  return { ok: true };
}
