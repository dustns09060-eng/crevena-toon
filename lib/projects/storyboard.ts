"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { cleanupProjectStorage, getProject, getProjectCharacters, getProjectPanels } from "./service";
import { getCharacter } from "../characters/service";
import { ProjectSettingsFormSchema } from "./formValidation";
import { getStoryboardProvider } from "../../src/providers/storyboardProviderRegistry";
import { validateStoryboardAgainstProject } from "../../src/providers/storyboardSchema";
import { mapStoryboardRawToDraft, type StoryboardDraft } from "../../src/providers/storyboardMapper";
import { validateToonDialogue } from "../../src/db/validation";
import { MAX_CHARACTERS_PER_PANEL } from "../../src/providers/projectPanelCountConfig";
import {
  assignCharacterIdentifiers,
  buildIdentifierToIdMap,
  MAX_IDENTIFIABLE_CHARACTERS,
} from "../../src/providers/characterIdentifier";
import { assignLocationIdentifiers, buildLocationIdentifierToIdMap } from "../../src/providers/locationIdentifier";
import { getSeriesLocations } from "../series/service";
import type { ToonProject } from "../../src/db/types";

/**
 * 021 — 프로젝트가 속한 시리즈의 Location Set을 LOCATION_A/B/C...
 * 식별자와 함께 resolve한다. 시리즈가 없거나(독립 프로젝트) 그
 * 시리즈에 연결된 장소가 하나도 없으면 빈 배열 — 이 경우 Storyboard
 * 프롬프트에서 Location 섹션 자체가 생략되고, AI는 location 필드를
 * 채우지 않는다(정상 동작, 레거시와 동일).
 */
async function resolveProjectLocations(supabase: Awaited<ReturnType<typeof createClient>>, project: ToonProject) {
  const locations = project.series_id ? await getSeriesLocations(supabase, project.series_id) : [];
  return assignLocationIdentifiers(
    locations.map((l) => ({
      id: l.id,
      display_name: l.display_name,
      visual_prompt: l.visual_prompt,
      wall_and_floor: l.wall_and_floor,
      fixed_furniture: l.fixed_furniture,
      window_style: l.window_style,
      recurring_props: l.recurring_props,
      distinctive_features: l.distinctive_features,
    }))
  ).map(({ identifier, location }) => ({ ...location, identifier }));
}

const inFlightStoryboardGeneration = new Set<string>();

export interface GenerateStoryboardState {
  ok: boolean;
  message?: string;
  draft?: StoryboardDraft;
}

async function requireOwnedProject(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." as const };

  // getProject는 RLS로 스코프되므로 남의 project_id면 null이 되어
  // 별도 소유권 비교 없이 타인 프로젝트 요청이 차단된다.
  const project = await getProject(supabase, projectId);
  if (!project) return { error: "프로젝트를 찾을 수 없거나 접근 권한이 없습니다." as const };

  return { supabase, user, project };
}

export async function generateStoryboardAction(projectId: string): Promise<GenerateStoryboardState> {
  const owned = await requireOwnedProject(projectId);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase, project } = owned;

  if (inFlightStoryboardGeneration.has(projectId)) {
    return { ok: false, message: "이미 이 프로젝트의 스토리보드를 생성하고 있습니다. 잠시만 기다려주세요." };
  }
  inFlightStoryboardGeneration.add(projectId);

  try {
    const characters = await getProjectCharacters(supabase, projectId);
    if (characters.length === 0) {
      return { ok: false, message: "프로젝트에 연결된 캐릭터가 없습니다." };
    }
    if (characters.length > MAX_IDENTIFIABLE_CHARACTERS) {
      return { ok: false, message: "이 에피소드에 등장 가능한 캐릭터 수가 너무 많습니다." };
    }
    if (!project.topic) {
      return { ok: false, message: "소재가 설정되지 않았습니다." };
    }

    // display_name 문자열 매칭 대신, 서버가 배열 순서대로 부여한
    // CHARACTER_A/B/C... identifier로 AI와 통신한다(유니코드 정규화
    // 차이로 인한 "알 수 없는 캐릭터" 오류를 원천적으로 없애기 위함).
    const identifiedCharacters = assignCharacterIdentifiers(characters).map(({ identifier, character }) => ({
      ...character,
      identifier,
    }));
    const identifiedLocations = await resolveProjectLocations(supabase, project);

    const provider = getStoryboardProvider();
    const raw = await provider.generateStoryboard({
      topic: project.topic,
      panelCount: project.panel_count,
      characters: identifiedCharacters,
      locations: identifiedLocations,
    });

    const validation = validateStoryboardAgainstProject(raw, {
      // project.panel_count는 표지 포함 TOTAL이고, 표지는 항상 정확히
      // 1개이므로 본문 장면 수는 항상 panel_count - 1이다.
      expectedSceneCount: project.panel_count - 1,
      allowedIdentifiers: identifiedCharacters.map((c) => c.identifier),
      allowedLocationIdentifiers: identifiedLocations.map((l) => l.identifier),
    });
    if (!validation.valid) {
      return {
        ok: false,
        message: "AI 스토리보드 결과가 유효하지 않아 사용할 수 없습니다: " + validation.errors.join(" / "),
      };
    }

    const identifierToId = buildIdentifierToIdMap(
      identifiedCharacters.map((c) => ({ identifier: c.identifier, character: c }))
    );
    const locationIdentifierToId = buildLocationIdentifierToIdMap(
      identifiedLocations.map((l) => ({ identifier: l.identifier, location: l }))
    );
    const draft = mapStoryboardRawToDraft(raw, identifierToId, locationIdentifierToId);

    return { ok: true, draft };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "스토리보드 생성 중 오류가 발생했습니다." };
  } finally {
    inFlightStoryboardGeneration.delete(projectId);
  }
}

export interface SaveStoryboardState {
  ok: boolean;
  message?: string;
}

type PanelRow = Record<string, unknown>;
type BuildPanelRowsResult = { ok: true; rows: PanelRow[] } | { ok: false; message: string };

/** 이 프로젝트의 기존 panel 상태에 따라 draft가 표지를 몇 개 가져야 하는지가 달라진다. */
export type ExistingCoverState =
  | "no_panels_yet" // 아직 panel이 하나도 없음(첫 스토리보드 생성) — 0개든 1개든 허용
  | "had_cover" // 이미 표지가 있었음 — 반드시 정확히 1개(삭제 금지)
  | "no_cover_legacy"; // panel은 있지만 전부 scene(레거시) — 표지를 새로 추가할 수 없음

function getExistingCoverState(existingPanels: { panel_type: string }[]): ExistingCoverState {
  if (existingPanels.length === 0) return "no_panels_yet";
  return existingPanels.some((p) => p.panel_type === "cover") ? "had_cover" : "no_cover_legacy";
}

/**
 * draft.panels → toon_panels upsert용 row 배열로 변환하면서 저장 시
 * 필요한 모든 교차 검증(컷 수 일치는 호출자가 미리 확인, 표지
 * 유지/위치, panel_number 연속성, 캐릭터 소속, 4명 제한, 대사 형식)을
 * 수행한다. saveStoryboardAction과 regenerateStoryboardWithSettingsAction
 * 양쪽에서 재사용해 검증 로직이 갈라지지 않게 한다.
 */
function buildPanelRowsFromDraft(
  projectId: string,
  draft: StoryboardDraft,
  opts: { allowedCharacterIds: Set<string>; allowedLocationIds: Set<string>; coverState: ExistingCoverState }
): BuildPanelRowsResult {
  const draftCovers = draft.panels.filter((p) => p.panel_type === "cover");
  // 022 — draft.temporaryLocations에 정의되지 않은 key를 참조하는 panel이
  // 없는지 방어적으로 재검증한다(이론상 mapStoryboardRawToDraft를 거친
  // draft는 항상 이 조건을 만족해야 하지만, 수동 편집 경로도 이 함수를
  // 거치므로 여기서도 막는다).
  const allowedTempKeys = new Set(draft.temporaryLocations.map((l) => l.location_key));

  if (opts.coverState === "had_cover" && draftCovers.length !== 1) {
    return { ok: false, message: "표지는 삭제하거나 여러 개로 만들 수 없습니다." };
  }
  if (opts.coverState === "no_cover_legacy" && draftCovers.length > 0) {
    return { ok: false, message: "이 프로젝트에는 표지를 추가할 수 없습니다." };
  }
  if (opts.coverState === "no_panels_yet" && draftCovers.length > 1) {
    return { ok: false, message: "표지는 하나만 있어야 합니다." };
  }
  if (draftCovers.length === 1 && draft.panels[0]?.panel_type !== "cover") {
    return { ok: false, message: "표지는 항상 첫 번째 컷이어야 합니다." };
  }

  const rows: PanelRow[] = [];
  for (const [index, panel] of draft.panels.entries()) {
    if (panel.panel_number !== index + 1) {
      return { ok: false, message: "panel_number가 1부터 연속되지 않습니다." };
    }
    for (const cid of panel.character_ids) {
      if (!opts.allowedCharacterIds.has(cid)) {
        return { ok: false, message: "허용되지 않은 캐릭터가 포함되어 있습니다." };
      }
    }
    if (panel.character_ids.length > MAX_CHARACTERS_PER_PANEL) {
      return { ok: false, message: `한 장면에는 최대 ${MAX_CHARACTERS_PER_PANEL}명의 등장인물을 사용할 수 있어요.` };
    }
    if (panel.location_id && !opts.allowedLocationIds.has(panel.location_id)) {
      return { ok: false, message: "허용되지 않은 장소가 포함되어 있습니다." };
    }
    if (panel.temp_location_key && !allowedTempKeys.has(panel.temp_location_key)) {
      return { ok: false, message: "정의되지 않은 임시 장소가 포함되어 있습니다." };
    }
    if (panel.location_id && panel.temp_location_key) {
      return { ok: false, message: "한 컷에 저장된 장소와 임시 장소를 동시에 지정할 수 없습니다." };
    }

    const dialogue = panel.dialogue.map((d) => ({
      id: d.id,
      character_id: d.character_id,
      text: d.text,
      bubble_type: "speech" as const,
      bubble: null,
    }));

    for (const line of dialogue) {
      if (!panel.character_ids.includes(line.character_id)) {
        return { ok: false, message: "대사 화자가 이 컷의 등장인물 목록에 없습니다." };
      }
    }

    const dialogueValidation = validateToonDialogue(dialogue);
    if (!dialogueValidation.valid) {
      return { ok: false, message: "대사 형식이 올바르지 않습니다: " + dialogueValidation.errors.join(" / ") };
    }

    rows.push({
      project_id: projectId,
      panel_number: panel.panel_number,
      panel_type: panel.panel_type,
      scene: panel.scene_description,
      narration: panel.narration,
      dialogue,
      character_ids: panel.character_ids,
      expression: panel.expression,
      image_prompt: panel.image_prompt,
      cover_title: panel.cover_title,
      cover_subtitle: panel.cover_subtitle,
      location_id: panel.location_id,
      time_of_day: panel.time_of_day,
      temp_location_key: panel.temp_location_key,
    });
  }

  return { ok: true, rows };
}

/**
 * 022 — temp locations upsert + panel upsert + obsolete temp location
 * cleanup을 하나의 Postgres transaction(RPC)으로 묶는다. AI 생성/검증은
 * 이 함수를 호출하기 전에 이미 끝난 상태여야 한다(느린 외부 API 호출을
 * DB transaction 안에 넣지 않는다) — 이 함수는 이미 검증된 결과만
 * 받아서 DB에 반영한다.
 */
async function commitStoryboardPanels(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  draft: StoryboardDraft,
  rows: PanelRow[]
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc("toon_save_storyboard_panels", {
    p_project_id: projectId,
    p_temp_locations: draft.temporaryLocations,
    p_panel_rows: rows,
  });
  if (error) {
    return { ok: false, message: "저장 중 오류가 발생했습니다: " + error.message };
  }
  return { ok: true };
}

export async function saveStoryboardAction(
  projectId: string,
  draft: StoryboardDraft
): Promise<SaveStoryboardState> {
  const owned = await requireOwnedProject(projectId);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase, project } = owned;

  if (draft.panels.length !== project.panel_count) {
    return {
      ok: false,
      message: `panel 개수(${draft.panels.length})가 프로젝트 컷 수(${project.panel_count})와 다릅니다.`,
    };
  }

  // 표지 삭제 방지: 이 프로젝트가 이미 표지를 갖고 있었다면(신규 스타일
  // episode), 저장하려는 draft에도 반드시 표지가 남아있어야 한다.
  const existingPanels = await getProjectPanels(supabase, projectId);
  const coverState = getExistingCoverState(existingPanels);

  const characters = await getProjectCharacters(supabase, projectId);
  const allowedIds = new Set(characters.map((c) => c.id));
  const identifiedLocations = await resolveProjectLocations(supabase, project);
  const allowedLocationIds = new Set(identifiedLocations.map((l) => l.id));

  const built = buildPanelRowsFromDraft(projectId, draft, {
    allowedCharacterIds: allowedIds,
    allowedLocationIds,
    coverState,
  });
  if (!built.ok) return { ok: false, message: built.message };

  const committed = await commitStoryboardPanels(supabase, projectId, draft, built.rows);
  if (!committed.ok) return committed;

  const updates: Record<string, unknown> = { story_summary: draft.summary };
  if (project.status === "draft") updates.status = "storyboard";
  const { error: projErr } = await supabase.from("toon_projects").update(updates).eq("id", projectId);
  if (projErr) {
    return { ok: false, message: "프로젝트 상태 갱신 중 오류가 발생했습니다: " + projErr.message };
  }

  revalidatePath(`/toon/projects/${projectId}`);
  return { ok: true };
}

export async function confirmStoryboardAction(projectId: string): Promise<SaveStoryboardState> {
  const owned = await requireOwnedProject(projectId);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase, project } = owned;

  const panels = await getProjectPanels(supabase, projectId);
  if (panels.length !== project.panel_count) {
    return { ok: false, message: "스토리보드를 먼저 저장해주세요 (컷 수가 일치하지 않습니다)." };
  }

  const { error } = await supabase.from("toon_projects").update({ status: "confirmed" }).eq("id", projectId);
  if (error) return { ok: false, message: "확정 중 오류가 발생했습니다." };

  revalidatePath(`/toon/projects/${projectId}`);
  return { ok: true };
}

export interface UpdateProjectSettingsInput {
  topic: string;
  panel_count: number;
  character_ids: string[];
}

export interface RegenerateWithSettingsState {
  ok: boolean;
  message?: string;
  draft?: StoryboardDraft;
  /** true면 컷수를 줄일 때 이미지가 있는 컷이 삭제될 수 있어 사용자 확인이 필요하다 — 아직 AI도 호출하지 않았고 아무것도 바뀌지 않았다. */
  needsImageConfirmation?: boolean;
  affectedPanelNumbers?: number[];
}

/**
 * 소재/컷수/등장인물을 바꾸고 그 새 설정으로 스토리보드를 즉시
 * 재생성해서 "설정 + 스토리보드"를 하나의 단위로 반영한다.
 *
 * 2-phase 흐름(실제 Postgres 트랜잭션이 아니라 "쓰기 순서"로 원자성을
 * 흉내낸다 — Supabase JS/PostgREST는 여러 문장을 묶는 클라이언트
 * 트랜잭션을 제공하지 않는다):
 *   1) 새 설정을 메모리에서만 검증(zod + 캐릭터 소유권)
 *   2) (컷수를 줄여 이미지가 삭제될 상황이면) AI를 호출하기 "전에"
 *      사용자 확인을 받는다 — 어차피 취소할 거라면 비용을 쓰지 않는다.
 *      단, 이 시점에는 DB를 전혀 건드리지 않는다.
 *   3) 새 설정으로 AI Storyboard 생성 (DB 미변경)
 *   4) AI 결과를 schema/identifier/장수 기준으로 검증 (DB 미변경)
 *   5) 3~4 중 하나라도 실패하면 여기서 끝 — topic/panel_count/캐릭터
 *      로스터/기존 panels/기존 이미지 전부 원래 그대로 남는다.
 *   6) 전부 성공했을 때만 실제로 커밋한다: (컷수 감소 시) 범위를 벗어난
 *      panel의 Storage+DB를 정리 → project 설정 갱신 → 캐릭터 로스터
 *      동기화 → 새 panel 저장.
 *
 * toon_characters/toon_character_sheets는 이 함수 어디에서도
 * 건드리지 않는다 — 기존 character_id를 그대로 재사용한다.
 */
export async function regenerateStoryboardWithSettingsAction(
  projectId: string,
  input: UpdateProjectSettingsInput,
  confirmDiscardImages = false
): Promise<RegenerateWithSettingsState> {
  const owned = await requireOwnedProject(projectId);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase, user, project } = owned;

  // STEP 8/완료 보호 원칙 재사용: 완성된 Episode는 "다시 편집하기"를
  // 먼저 거쳐야 한다 — 여기서 바로 설정을 바꾸지 못하게 막는다.
  if (project.status === "completed") {
    return { ok: false, message: "완성된 프로젝트는 먼저 '다시 편집하기'를 눌러주세요." };
  }

  if (inFlightStoryboardGeneration.has(projectId)) {
    return { ok: false, message: "이미 이 프로젝트의 스토리보드를 생성하고 있습니다. 잠시만 기다려주세요." };
  }

  // ---- Phase 0: 순수 검증(메모리에서만, DB 미변경) ----
  const validation = ProjectSettingsFormSchema.safeParse(input);
  if (!validation.success) {
    return { ok: false, message: validation.error.issues.map((i) => i.message).join(" / ") };
  }
  const { topic, panel_count: newPanelCount, character_ids: newCharacterIds } = validation.data;

  if (newCharacterIds.length > MAX_IDENTIFIABLE_CHARACTERS) {
    return { ok: false, message: "이 에피소드에 등장 가능한 캐릭터 수가 너무 많습니다." };
  }

  // getCharacter는 RLS로 스코프되므로 남의 character_id면 null이 되어
  // 타인 캐릭터를 선택하려는 시도가 차단된다.
  const fullCharacters = [];
  for (const id of newCharacterIds) {
    const character = await getCharacter(supabase, id);
    if (!character) return { ok: false, message: "선택한 캐릭터 중 접근할 수 없는 캐릭터가 있습니다." };
    fullCharacters.push(character);
  }

  const existingPanels = await getProjectPanels(supabase, projectId);
  const outOfRangePanels = existingPanels.filter((p) => p.panel_number > newPanelCount);
  const outOfRangeHasImages = outOfRangePanels.some((p) => p.raw_image_url || p.image_url);

  // 컷수를 줄여서 이미지가 삭제될 상황이면 AI 호출 "전에" 확인받는다 —
  // 여기서도 DB는 전혀 건드리지 않는다. 확인을 안 받았다면 여기서 끝.
  if (outOfRangeHasImages && !confirmDiscardImages) {
    return {
      ok: false,
      needsImageConfirmation: true,
      affectedPanelNumbers: outOfRangePanels.map((p) => p.panel_number),
      message: "컷수를 줄이면 일부 컷의 이미지가 삭제됩니다. 계속할까요?",
    };
  }

  // AI 전체 재생성은 "이 에피소드의 콘텐츠를 새로 만드는" 행위라,
  // 예전에 표지 없이 저장된 레거시 스토리보드였더라도 새 표지 포함
  // 결과로 업그레이드하는 것을 막지 않는다(반대로 이미 표지가 있던
  // 경우엔 여전히 삭제를 막는다) — saveStoryboardAction의 수동 편집
  // 경로(장면 추가/삭제/직접 수정)에서만 "no_cover_legacy"를 엄격히
  // 적용한다.
  const rawCoverState = getExistingCoverState(existingPanels);
  const coverState: ExistingCoverState = rawCoverState === "no_cover_legacy" ? "no_panels_yet" : rawCoverState;

  inFlightStoryboardGeneration.add(projectId);
  try {
    // ---- Phase 1: AI 생성 + 검증 (DB 미변경) ----
    const storyboardCharacters = fullCharacters.map((c) => ({
      id: c.id,
      display_name: c.display_name,
      role: c.role ?? "",
      personality: c.personality,
      speaking_style: c.speaking_style,
    }));
    const identifiedCharacters = assignCharacterIdentifiers(storyboardCharacters).map(({ identifier, character }) => ({
      ...character,
      identifier,
    }));
    const identifiedLocations = await resolveProjectLocations(supabase, project);

    const provider = getStoryboardProvider();
    let raw;
    try {
      raw = await provider.generateStoryboard({
        topic,
        panelCount: newPanelCount,
        characters: identifiedCharacters,
        locations: identifiedLocations,
      });
    } catch (e) {
      // AI 호출 자체가 실패해도 DB는 아직 전혀 바뀌지 않았다.
      return { ok: false, message: e instanceof Error ? e.message : "스토리보드 생성 중 오류가 발생했습니다." };
    }

    const scheduleValidation = validateStoryboardAgainstProject(raw, {
      expectedSceneCount: newPanelCount - 1,
      allowedIdentifiers: identifiedCharacters.map((c) => c.identifier),
      allowedLocationIdentifiers: identifiedLocations.map((l) => l.identifier),
    });
    if (!scheduleValidation.valid) {
      // 검증 실패 — 여전히 DB 미변경. 기존 topic/panel_count/storyboard/
      // 이미지가 전부 그대로 보존된다.
      return {
        ok: false,
        message: "AI 스토리보드 결과가 유효하지 않아 사용할 수 없습니다: " + scheduleValidation.errors.join(" / "),
      };
    }

    const identifierToId = buildIdentifierToIdMap(
      identifiedCharacters.map((c) => ({ identifier: c.identifier, character: c }))
    );
    const locationIdentifierToId = buildLocationIdentifierToIdMap(
      identifiedLocations.map((l) => ({ identifier: l.identifier, location: l }))
    );
    const draft = mapStoryboardRawToDraft(raw, identifierToId, locationIdentifierToId);

    const built = buildPanelRowsFromDraft(projectId, draft, {
      allowedCharacterIds: new Set(newCharacterIds),
      allowedLocationIds: new Set(identifiedLocations.map((l) => l.id)),
      coverState,
    });
    if (!built.ok) {
      // 이론상 mapStoryboardRawToDraft가 만든 draft는 항상 이 검증을
      // 통과해야 하지만, 방어적으로 여기서도 막고 DB는 건드리지 않는다.
      return { ok: false, message: built.message };
    }

    // ---- Phase 2: 여기부터만 실제로 DB에 반영한다 (AI 성공 확정 후) ----
    if (outOfRangePanels.length > 0) {
      await cleanupProjectStorage(
        supabase,
        user.id,
        projectId,
        outOfRangePanels.map((p) => p.panel_number)
      );
      const { error: deletePanelsErr } = await supabase
        .from("toon_panels")
        .delete()
        .eq("project_id", projectId)
        .gt("panel_number", newPanelCount);
      if (deletePanelsErr) return { ok: false, message: "컷 삭제 중 오류가 발생했습니다." };
    }

    // 컷수를 늘리는 경우는 panel_count를 "먼저" 올려야 한다 — panel_number
    // range 트리거가 새 panel_number가 현재 panel_count를 넘으면
    // INSERT/UPDATE 자체를 거부하기 때문이다.
    const { error: projectUpdateErr } = await supabase
      .from("toon_projects")
      .update({ topic, panel_count: newPanelCount, story_summary: draft.summary })
      .eq("id", projectId);
    if (projectUpdateErr) return { ok: false, message: "프로젝트 설정 갱신에 실패했습니다." };

    // 등장인물 roster 동기화 — toon_characters/toon_character_sheets는
    // 전혀 건드리지 않고 toon_project_characters 연결만 맞춘다.
    const currentCharacters = await getProjectCharacters(supabase, projectId);
    const currentIds = new Set(currentCharacters.map((c) => c.id));
    const nextIds = new Set(newCharacterIds);
    const toRemove = [...currentIds].filter((id) => !nextIds.has(id));
    const toAdd = [...nextIds].filter((id) => !currentIds.has(id));

    if (toRemove.length > 0) {
      const { error: removeErr } = await supabase
        .from("toon_project_characters")
        .delete()
        .eq("project_id", projectId)
        .in("character_id", toRemove);
      if (removeErr) return { ok: false, message: "등장인물 목록 갱신에 실패했습니다." };
    }
    if (toAdd.length > 0) {
      const { error: addErr } = await supabase
        .from("toon_project_characters")
        .insert(toAdd.map((characterId) => ({ project_id: projectId, character_id: characterId })));
      if (addErr) return { ok: false, message: "등장인물 목록 갱신에 실패했습니다." };
    }

    const committed = await commitStoryboardPanels(supabase, projectId, draft, built.rows);
    if (!committed.ok) return committed;

    if (project.status === "draft") {
      await supabase.from("toon_projects").update({ status: "storyboard" }).eq("id", projectId);
    }

    revalidatePath(`/toon/projects/${projectId}`);
    return { ok: true, draft };
  } catch (e) {
    // Storage 정리/DB 반영 단계에서 예외가 나도 깔끔한 실패 응답으로
    // 바꾼다 — cleanupProjectStorage를 panel 삭제보다 먼저 호출하므로,
    // 여기서 실패하면 panel/panel_count는 아직 갱신되지 않은 상태다.
    return { ok: false, message: e instanceof Error ? e.message : "스토리보드 재생성 중 오류가 발생했습니다." };
  } finally {
    inFlightStoryboardGeneration.delete(projectId);
  }
}
