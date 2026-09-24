"use server";

import { redirect } from "next/navigation";
import { getServerRuntimeReadiness } from "../config/runtime";
import { createClient } from "../supabase/server";

export interface LoginState {
  ok: boolean;
  message?: string;
}

export async function signInAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { ok: false, message: "이메일과 비밀번호를 입력해주세요." };
  }

  const readiness = getServerRuntimeReadiness();
  if (!readiness.loginReady) {
    return { ok: false, message: `서비스 설정이 필요합니다: ${readiness.missingForLogin.join(", ")}` };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { ok: false, message: "이메일 또는 비밀번호를 확인해주세요." };
  }

  redirect("/toon/characters");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/toon/login");
}
