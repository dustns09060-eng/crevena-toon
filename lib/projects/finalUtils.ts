import type { ToonPanel, ToonProject } from "../../src/db/types";

/**
 * 순수 유틸 — "use server" 파일(finalPage.ts)과 서버 컴포넌트
 * (final/page.tsx) 양쪽에서 재사용한다. editorUtils.ts/bibleUtils.ts와
 * 같은 이유(Server Action 파일은 모든 export가 async여야 함)로
 * 별도 파일로 분리했다.
 */

export interface CompletionReadiness {
  ready: boolean;
  errors: string[];
}

/**
 * STEP 8 §1 — 프로젝트를 completed로 전환하려면:
 * storyboard가 confirmed(또는 이미 completed) 상태이고, 모든 컷에
 * 승인된 raw 이미지와 최종(final) 이미지가 있어야 한다. 클라이언트
 * 버튼 비활성화뿐 아니라 completeProjectAction()에서도 재검증해
 * 실제 방어선으로 쓴다.
 */
export function checkCompletionReadiness(project: ToonProject | null, panels: ToonPanel[]): CompletionReadiness {
  const errors: string[] = [];
  if (!project) {
    errors.push("프로젝트를 찾을 수 없거나 접근 권한이 없습니다.");
    return { ready: false, errors };
  }
  if (project.status !== "confirmed" && project.status !== "completed") {
    errors.push("스토리보드가 아직 확정되지 않았습니다.");
  }
  if (panels.length === 0) {
    errors.push("컷이 없습니다.");
    return { ready: false, errors };
  }
  const missingRaw = panels.filter((p) => !p.raw_image_url);
  if (missingRaw.length > 0) {
    errors.push(`아직 승인된 원본 이미지가 없는 컷이 있습니다 (컷 ${missingRaw.map((p) => p.panel_number).join(", ")}).`);
  }
  const missingFinal = panels.filter((p) => !p.image_url);
  if (missingFinal.length > 0) {
    errors.push("아직 최종 이미지가 만들어지지 않은 컷이 있어요.");
  }
  return { ready: errors.length === 0, errors };
}

/**
 * STEP 8 §15 — DB status 값과 사람이 읽는 UI 라벨을 분리한다.
 * "confirmed" 하나로는 "이미지 제작 중 / 최종 편집 중 / 최종 확인 중"을
 * 구분할 수 없으므로(STEP6~8이 모두 status='confirmed'를 공유), 패널
 * 진행 상태를 함께 봐서 더 세밀한 라벨을 계산한다. DB에 새 상태값을
 * 추가하지 않고도(마이그레이션 불필요) UI만 더 친절하게 만드는 방식이다.
 */
export function getProjectStatusLabel(project: ToonProject, panels: ToonPanel[]): string {
  switch (project.status) {
    case "draft":
      return "작성 중";
    case "storyboard":
      return "스토리보드 작성 중";
    case "generating":
      return "이미지 제작 중";
    case "completed":
      return "완성";
    case "failed":
      return "실패";
    case "confirmed": {
      if (panels.length === 0) return "이미지 제작 중";
      const allFinal = panels.every((p) => p.image_url);
      const allRaw = panels.every((p) => p.raw_image_url);
      if (allFinal) return "최종 확인 중";
      if (allRaw) return "최종 편집 중";
      return "이미지 제작 중";
    }
    default:
      return project.status;
  }
}
