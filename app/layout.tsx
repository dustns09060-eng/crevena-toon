import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crevena 인스타툰 캐릭터",
  description: "인스타툰에 등장할 나만의 캐릭터를 등록하고 관리합니다.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/*
          STEP 7 §7 — 한국어 말풍선/내레이션 텍스트용 웹폰트.
          Noto Sans KR은 SIL Open Font License 1.1로 배포되어 재배포/
          서비스 내 사용이 명시적으로 허용된다
          (라이선스 전문: https://openfontlicense.org).
          next/font/google의 Google Fonts subset 목록에는 CJK 폰트의
          "korean" subset이 없어(라틴 subset만 선택하면 한글 글리프가
          아예 빠진다), 대신 Google Fonts CSS API를 직접 링크해서
          한글을 포함한 전체 글리프셋을 받는다. 특정 사용자 PC에 폰트가
          설치되어 있는지에 의존하지 않는다.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router 루트 레이아웃에 전역 적용, pages/_document 대상 규칙은 해당 없음 */}
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
