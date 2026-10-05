import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { getCharacters, getCharacterCardSignedUrl } from "../../../lib/characters/service";
import DeleteCharacterButton from "./DeleteCharacterButton";

export default async function CharactersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");

  const characters = await getCharacters(supabase);
  const thumbnails = await Promise.all(
    characters.map((c) => getCharacterCardSignedUrl(supabase, c).catch(() => null))
  );

  return (
    <main className="page-wide library-page">
      <div className="topbar">
        <h1>내 캐릭터</h1>
        <Link href="/toon/characters/new" className="btn btn-primary">+ 새 캐릭터</Link>
      </div>

      {characters.length === 0 ? (
        <div className="empty-state">
          <p>{"아직 등록된 캐릭터가 없어요.\n인스타툰에 등장할 나만의 캐릭터를 만들어보세요."}</p>
          <Link href="/toon/characters/new" className="btn btn-primary">
            첫 캐릭터 만들기
          </Link>
        </div>
      ) : (
        <>
          <div className="library-grid">
            {characters.map((c, i) => (
              <div className="card library-card" key={c.id}>
                {thumbnails[i] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbnails[i]!} alt={`${c.display_name} 캐릭터`} loading="lazy" className="library-card__portrait" />
                ) : (
                  <div className="library-card__portrait" />
                )}
                <div className="char-card__body">
                  <div className="char-card__name">{c.display_name}</div>
                  <div className="char-card__role">{c.role || "역할 미지정"}</div>
                </div>
                <div className="char-card__actions">
                  <Link href={`/toon/characters/${c.id}`} className="btn">
                    캐릭터 열기
                  </Link>
                  <details className="library-menu"><summary aria-label={`${c.display_name} 관리`}>관리</summary><DeleteCharacterButton characterId={c.id} characterName={c.display_name} /></details>
                </div>
              </div>
            ))}
          </div>
          <Link href="/toon/characters/new" className="btn btn-primary btn-block">
            새 캐릭터 만들기
          </Link>
        </>
      )}
    </main>
  );
}
