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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
