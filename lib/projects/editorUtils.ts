import type { ToonPanel, ToonProject } from "../../src/db/types";

/**
 * 순수 유틸 함수 — "use server" 파일(editor.ts)과 서버 컴포넌트
 * (editor/page.tsx) 양쪽에서 재사용한다. bibleUtils.ts와 동일한 이유로
 * 별도 파일로 분리했다: Next.js Server Action 파일은 모든 export가
 * async 함수여야 한다.
 */

export interface EditorReadiness {
  ready: boolean;
  errors: string[];
}

/**
 * STEP 7 §1 — 모든 컷에 승인된 원본(raw) 이미지가 있어야만 편집기에
 * 들어갈 수 있다. toon_panels.raw_image_url은 approvePanelImageAction()
 * 에서만 채워지므로, 이 값의 존재 여부가 "승인 완료"의 신뢰할 수 있는
 * 신호다. 클라이언트 비활성화뿐 아니라 이 함수를 서버(페이지, 각 액션)
 * 양쪽에서 재사용해 실제 방어선으로 쓴다.
 */
export function checkEditorReadiness(project: ToonProject | null, panels: ToonPanel[]): EditorReadiness {
  const errors: string[] = [];
  if (!project) {
    errors.push("프로젝트를 찾을 수 없거나 접근 권한이 없습니다.");
    return { ready: false, errors };
  }
  if (panels.length === 0) {
    errors.push("컷이 없습니다.");
    return { ready: false, errors };
  }
  const missing = panels.filter((p) => !p.raw_image_url);
  if (missing.length > 0) {
    errors.push(`아직 승인된 이미지가 없는 컷이 있습니다 (컷 ${missing.map((p) => p.panel_number).join(", ")}).`);
  }
  return { ready: errors.length === 0, errors };
}
