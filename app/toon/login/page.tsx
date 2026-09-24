import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { getServerRuntimeReadiness } from "../../../lib/config/runtime";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const readiness = getServerRuntimeReadiness();
  if (readiness.loginReady) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect("/toon/characters");
  }

  return (
    <main className="page">
      <div className="topbar">
        <h1>Crevena Toon 관리자 로그인</h1>
      </div>
      <p className="upload-note">등록된 관리자 계정으로 로그인해 인스타툰 제작을 시작하세요.</p>
      {!readiness.loginReady && (
        <div className="banner banner-error" role="alert">
          <strong>서비스 설정이 필요합니다.</strong>
          <div className="setup-code">{readiness.missingForLogin.join(", ")}</div>
          <p>배포 환경 또는 <code>.env.local</code>에 위 값을 입력한 뒤 다시 실행해주세요.</p>
        </div>
      )}
      <div className="card">
        <LoginForm disabled={!readiness.loginReady} />
      </div>
    </main>
  );
}
