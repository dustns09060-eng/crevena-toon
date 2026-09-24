"use client";

import { useActionState } from "react";
import { signInAction, type LoginState } from "../../../lib/auth/actions";

const initialState: LoginState = { ok: true };

export default function LoginForm({ disabled = false }: { disabled?: boolean }) {
  const [state, formAction, pending] = useActionState(signInAction, initialState);

  return (
    <form action={formAction}>
      {!state.ok && state.message && <div className="banner banner-error">{state.message}</div>}

      <div className="field">
        <label htmlFor="email">이메일</label>
        <input id="email" name="email" type="email" className="input" required autoComplete="email" />
      </div>

      <div className="field">
        <label htmlFor="password">비밀번호</label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          required
          autoComplete="current-password"
        />
      </div>

      <button type="submit" className="btn btn-primary btn-block" disabled={pending || disabled}>
        {disabled ? "설정 후 로그인할 수 있어요" : pending ? "로그인 중..." : "로그인"}
      </button>
    </form>
  );
}
