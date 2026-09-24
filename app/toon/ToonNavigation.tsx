"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "../../lib/auth/actions";

const items = [
  { href: "/toon/characters", label: "캐릭터" },
  { href: "/toon/series", label: "시리즈" },
  { href: "/toon/locations", label: "장소" },
  { href: "/toon/projects", label: "프로젝트" },
];

export default function ToonNavigation() {
  const pathname = usePathname();
  if (pathname === "/toon/login") return null;

  return (
    <header className="toon-header">
      <div className="toon-header__inner">
        <Link href="/toon/projects" className="toon-brand" aria-label="Crevena Toon 프로젝트로 이동">
          <span className="toon-brand__mark" aria-hidden="true">C</span>
          <span>Crevena Toon</span>
        </Link>
        <nav className="toon-nav" aria-label="Crevena Toon 주요 메뉴">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href} className={active ? "toon-nav__link is-active" : "toon-nav__link"}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <form action={signOutAction}>
          <button type="submit" className="toon-nav__logout">로그아웃</button>
        </form>
      </div>
    </header>
  );
}
