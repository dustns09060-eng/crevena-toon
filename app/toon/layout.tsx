import type { ReactNode } from "react";
import { getServerRuntimeReadiness } from "../../lib/config/runtime";
import ToonNavigation from "./ToonNavigation";

export default function ToonLayout({ children }: { children: ReactNode }) {
  const readiness = getServerRuntimeReadiness();

  return (
    <>
      <ToonNavigation />
      {!readiness.generationReady && readiness.loginReady && (
        <div className="runtime-warning" role="status">
          AI 생성 기능 설정 필요: {readiness.missingForGeneration.join(", ")}
        </div>
      )}
      {children}
    </>
  );
}
