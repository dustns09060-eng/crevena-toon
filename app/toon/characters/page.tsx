import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { getCharacters, getCharacterCardSignedUrl } from "../../../lib/characters/service";
import { signOutAction } from "../../../lib/auth/actions";
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
    <main className="page">
      <div className="topbar">
        <h1>내 캐릭터</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/toon/series" className="btn">
            시리즈
          </Link>
          <Link href="/toon/locations" className="btn">
            장소
          </Link>
          <Link href="/toon/projects" className="btn">
            프로젝트
          </Link>
          <form action={signOutAction}>
            <button type="submit" className="btn">
              로그아웃
            </button>
          </form>
        </div>
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
          <div className="char-list">
            {characters.map((c, i) => (
              <div className="card char-card" key={c.id}>
                {thumbnails[i] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbnails[i]!} alt="" className="char-card__thumb" />
                ) : (
                  <div className="char-card__thumb" />
                )}
                <div className="char-card__body">
                  <div className="char-card__name">{c.display_name}</div>
                  <div className="char-card__role">{c.role || "역할 미지정"}</div>
                </div>
                <div className="char-card__actions">
                  <Link href={`/toon/characters/${c.id}`} className="btn">
                    수정
                  </Link>
                  <DeleteCharacterButton characterId={c.id} characterName={c.display_name} />
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
