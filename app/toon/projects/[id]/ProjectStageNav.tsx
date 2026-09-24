import Link from "next/link";

export default function ProjectStageNav({
  projectId,
  active,
  imagesEnabled,
}: {
  projectId: string;
  active: "storyboard" | "images";
  imagesEnabled: boolean;
}) {
  return (
    <nav className="project-stage-nav" aria-label="프로젝트 제작 단계">
      <Link
        href={`/toon/projects/${projectId}`}
        className={`project-stage-nav__item${active === "storyboard" ? " is-active" : ""}`}
        aria-current={active === "storyboard" ? "page" : undefined}
      >
        <span className="project-stage-nav__number">1</span>
        <span>
          <strong>스토리보드</strong>
          <small>장면·대사 구성</small>
        </span>
      </Link>

      {imagesEnabled ? (
        <Link
          href={`/toon/projects/${projectId}/images`}
          className={`project-stage-nav__item${active === "images" ? " is-active" : ""}`}
          aria-current={active === "images" ? "page" : undefined}
        >
          <span className="project-stage-nav__number">2</span>
          <span>
            <strong>이미지 컷</strong>
            <small>생성·선택·수정</small>
          </span>
        </Link>
      ) : (
        <span className="project-stage-nav__item is-disabled" aria-disabled="true">
          <span className="project-stage-nav__number">2</span>
          <span>
            <strong>이미지 컷</strong>
            <small>스토리보드 확정 후</small>
          </span>
        </span>
      )}
    </nav>
  );
}
