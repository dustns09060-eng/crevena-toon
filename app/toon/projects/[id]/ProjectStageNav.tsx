import Link from "next/link";
export default function ProjectStageNav({ projectId, active, imagesEnabled, editorEnabled = false, finalEnabled = false }: {
  projectId: string; active: "storyboard" | "images" | "editor" | "final";
  imagesEnabled: boolean; editorEnabled?: boolean; finalEnabled?: boolean;
}) {
  const steps = [
    { key: "storyboard", path: "", label: "스토리보드", hint: "장면·대사 구성", enabled: true },
    { key: "images", path: "/images", label: "이미지", hint: imagesEnabled ? "생성·선택·수정" : "스토리 확정 후", enabled: imagesEnabled },
    { key: "editor", path: "/editor", label: "대사 편집", hint: editorEnabled ? "말풍선·내레이션" : "이미지 승인 후", enabled: editorEnabled },
    { key: "final", path: "/final", label: "완성·다운로드", hint: finalEnabled ? "최종 확인·ZIP" : "최종 이미지 제작 후", enabled: finalEnabled },
  ];
  return <nav className="project-stage-nav" aria-label="프로젝트 제작 단계">{steps.map((step, index) => {
    const contents = <><span className="project-stage-nav__number">{index + 1}</span><span><strong>{step.label}</strong><small>{step.hint}</small></span></>;
    return step.enabled || step.key === active
      ? <Link key={step.key} href={`/toon/projects/${projectId}${step.path}`} className={`project-stage-nav__item${active === step.key ? " is-active" : ""}`} aria-current={active === step.key ? "step" : undefined}>{contents}</Link>
      : <span key={step.key} className="project-stage-nav__item is-disabled" aria-disabled="true">{contents}</span>;
  })}</nav>;
}
