import { notFound, redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { getCharacter, getReferenceSignedUrl, listReferences } from "../../../../lib/characters/service";
import EditCharacterForm from "./EditCharacterForm";
import ReferenceGallery from "./ReferenceGallery";
import CharacterBibleSection from "./CharacterBibleSection";
import CharacterSheetSection from "./CharacterSheetSection";
import { getCharacterSheetsView } from "../../../../lib/characters/characterSheet";
import DeleteCharacterButton from "../DeleteCharacterButton";

export default async function CharacterDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string; photoError?: string }>;
}) {
  const { id } = await params;
  const { new: newFlag, photoError } = await searchParams;
  const isNewCharacterFlow = newFlag === "1";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");

  const character = await getCharacter(supabase, id);
  if (!character) notFound();

  const references = await listReferences(supabase, id);
  const referenceItems = await Promise.all(
    references.map(async (r) => ({
      id: r.id,
      isPrimary: r.is_primary,
      signedUrl: await getReferenceSignedUrl(supabase, r.storage_path).catch(() => null),
    }))
  );

  const { approved: approvedSheet, latestCandidate } = await getCharacterSheetsView(id);

  return (
    <main className="page">
      <div className="topbar">
        <h1>{character.display_name}</h1>
      </div>

      {photoError === "1" && (
        <div className="banner banner-error">
          일부 참조 사진 업로드에 실패했습니다. 캐릭터 정보는 저장되었으니 아래에서 사진을 다시 추가해주세요.
        </div>
      )}

      <div className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>참조 사진</h2>
        <ReferenceGallery characterId={id} initialReferences={referenceItems} />
      </div>

      <div className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Character Bible (AI 분석)</h2>
        <CharacterBibleSection characterId={id} character={character} />
      </div>

      <div className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Character Sheet</h2>
        <CharacterSheetSection
          characterId={id}
          initialApproved={approvedSheet}
          initialCandidate={latestCandidate}
          isNewCharacterFlow={isNewCharacterFlow}
        />
      </div>

      <div className="card">
        <EditCharacterForm character={character} />
      </div>

      <div className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>캐릭터 삭제</h2>
        <p className="hint">
          프로젝트에서 이미 사용 중인 캐릭터는 삭제할 수 없습니다. 먼저 프로젝트 연결을 해제해주세요.
        </p>
        <DeleteCharacterButton
          characterId={id}
          characterName={character.display_name}
          redirectOnSuccess="/toon/characters"
        />
      </div>
    </main>
  );
}
