"use server";

import { redirect } from "next/navigation";
import { createClient } from "../supabase/server";

export interface LoginState {
  ok: boolean;
  message?: string;
}

/**
 * 임시 개발/테스트용 로그인 페이지에서 사용하는 액션.
 * STEP 2 요청 페이지 목록에는 없지만, 실제 브라우저에서 캐릭터 CRUD를
 * 검증하려면 로그인 수단이 있어야 해서 최소한으로 추가했다 — 향후
 * Crevena 본체의 인증 시스템과 통합되면 이 페이지는 대체될 예정이다.
 */
export async function signInAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { ok: false, message: "이메일과 비밀번호를 입력해주세요." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { ok: false, message: "로그인에 실패했습니다: " + error.message };
  }

  redirect("/toon/characters");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/toon/login");
}
