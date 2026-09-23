import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="page">
      <div className="topbar">
        <h1>로그인</h1>
      </div>
      <p className="upload-note">
        개발/검증용 임시 로그인 화면입니다. 향후 Crevena 본체의 로그인과 통합될 예정입니다.
      </p>
      <div className="card">
        <LoginForm />
      </div>
    </main>
  );
}
