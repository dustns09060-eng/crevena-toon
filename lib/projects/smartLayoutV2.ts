"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { getProject, getProjectPanels } from "./service";
import { canArrangeV2, panelLayoutSource } from "../editor/layoutProvenance";
import { smartLayoutV2, type VisualResult } from "../editor/visualScoring";
import { getOrAnalyzeVisual, selectiveReanalysisPaths, validCachedAnalysis, visualCachePath, visualImageKey, type ImageIdentity, type VisualCacheStore } from "./visualAnalysisCache";
import { createGeminiVisualAnalyzer, prepareVisualImage, type VisualFailureCode } from "../../src/providers/geminiVisualAnalyzer";
import { VISUAL_ANALYSIS_MODEL, summarizeVisualRegions, type VisualCache, type VisualRegionSummary } from "../../src/providers/visualAnalysisSchema";
import { validateCoverTitleBubble, validateNarrationBubble, validateToonDialogue } from "../../src/db/validation";
import type { ToonPanel } from "../../src/db/types";

type Client = Awaited<ReturnType<typeof createClient>>;
type Target = { id: string; updatedAt: string; imageRowId: string; storagePath: string };
export type PreviewEntry = { target: Target; result: VisualResult; analysis: "CACHED" | "ANALYZED" | "ANALYSIS_FAILED" | "NOT_NEEDED"; failureCode?: VisualFailureCode; summary?: VisualRegionSummary };
const BUCKET = "toon-panels";
const inFlight = new Set<string>();
const reanalysisInFlight = new Set<string>();

function smartPanel(panel: ToonPanel) {
  return { id: panel.id, panelType: panel.panel_type, dialogue: panel.dialogue, narration: panel.narration,
    narrationBubble: panel.narration_bubble, coverTitle: panel.cover_title, coverSubtitle: panel.cover_subtitle,
    coverTitleBubble: panel.cover_title_bubble, hasStoredLayout: false };
}
function layoutSnapshot(panel: ToonPanel) {
  return panel.panel_type === "cover" ? { cover_title_bubble: panel.cover_title_bubble }
    : { dialogue: panel.dialogue, narration_bubble: panel.narration_bubble };
}
async function owned(projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw Error("로그인이 필요합니다.");
  const project = await getProject(supabase, projectId);
  if (!project || project.user_id !== user.id || project.status === "completed") throw Error("프로젝트를 편집할 수 없습니다.");
  const panels = await getProjectPanels(supabase, projectId);
  if (panels.length !== project.panel_count) throw Error("컷 구성을 확인할 수 없습니다.");
  const { data: images, error } = await supabase.from("toon_panel_images")
    .select("id,panel_id,storage_path,provider").in("panel_id", panels.map((p) => p.id)).eq("status", "approved");
  if (error) throw Error("승인 이미지를 확인할 수 없습니다.");
  const identities = panels.map((panel) => {
    const row = images?.find((image) => image.panel_id === panel.id && image.storage_path === panel.raw_image_url);
    if (!row || !panel.raw_image_url) throw Error("승인 원본과 컷의 연결이 다릅니다.");
    return { userId: user.id, projectId, panelId: panel.id, imageRowId: row.id, storagePath: row.storage_path } satisfies ImageIdentity;
  });
  return { supabase, panels, identities };
}
function cacheStore(supabase: Client): VisualCacheStore {
  return {
    async read(path) {
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      if (error || !data || data.size > 256_000) return null;
      try { return JSON.parse(await data.text()); } catch { return null; }
    },
    async write(path, data: VisualCache) {
      // Only this derived analysis JSON can be replaced. Approved originals are untouched.
      const { error } = await supabase.storage.from(BUCKET).upload(path, JSON.stringify(data), { contentType: "application/json", upsert: true });
      if (error) throw Error("분석 cache 저장 실패");
    },
    async tryLock(path) {
      const { error } = await supabase.storage.from(BUCKET).upload(`${path}.lock`, "pending", { contentType: "text/plain", upsert: false });
      return !error;
    },
    async unlock(path) { await supabase.storage.from(BUCKET).remove([`${path}.lock`]); },
  };
}

export async function visualCacheSummaryAction(projectId: string, overwrite = false, targetId: string | null = null): Promise<{ ok: boolean; cached?: number; needed?: number; message?: string }> {
  try {
    const { supabase, identities, panels } = await owned(projectId);
    const store = cacheStore(supabase);
    const found = await Promise.all(identities.flatMap((identity, index) => targetId && targetId !== panels[index].id
      || !canArrangeV2(smartPanel(panels[index]), visualImageKey(identity), overwrite) ? []
      : [store.read(visualCachePath(identity)).then((value) => Boolean(validCachedAnalysis(value, identity))).catch(() => false)]));
    return { ok: true, cached: found.filter(Boolean).length, needed: found.filter((hit) => !hit).length };
  } catch { return { ok: false, message: "분석 cache 상태를 확인하지 못했습니다." }; }
}

/** A one-time, user-confirmed refresh of exactly one immutable image identity.
 * The marker persists in the same project analysis namespace to bound cost. */
export async function reanalyzeVisualAction(projectId: string, panelId: string, imageRowId: string, confirmed: boolean): Promise<{ ok: boolean; entries?: PreviewEntry[]; message?: string }> {
  if (!confirmed) return { ok: false, message: "이미지 재분석 확인이 필요합니다." };
  try {
    const { supabase, panels, identities } = await owned(projectId);
    const index = panels.findIndex((panel) => panel.id === panelId);
    if (index < 0 || identities[index].imageRowId !== imageRowId) return { ok: false, message: "이미지가 변경됐습니다. 다시 확인해주세요." };
    const identity = identities[index], paths = selectiveReanalysisPaths(identity);
    if (reanalysisInFlight.has(paths.cache)) return { ok: false, message: "이미 재분석 중입니다." };
    reanalysisInFlight.add(paths.cache);
    try {
      const store = cacheStore(supabase);
      const cached = validCachedAnalysis(await store.read(paths.cache), identity);
      if (!cached) return { ok: false, message: "재분석할 유효 cache가 없습니다." };
      const { error: markerError } = await supabase.storage.from(BUCKET).upload(paths.marker,
        JSON.stringify({ image_row_id: imageRowId, created_at: new Date().toISOString() }),
        { contentType: "application/json", upsert: false });
      if (markerError) return { ok: false, message: "이 이미지의 재분석은 이미 요청됐습니다." };
      const { error: removeError } = await supabase.storage.from(BUCKET).remove([paths.cache]);
      if (removeError) {
        await supabase.storage.from(BUCKET).remove([paths.marker]);
        return { ok: false, message: "분석 cache를 갱신하지 못했습니다." };
      }
      return await prepareSmartV2PreviewAction(projectId, true, panelId);
    } finally { reanalysisInFlight.delete(paths.cache); }
  } catch { return { ok: false, message: "이미지 재분석을 준비하지 못했습니다." }; }
}

export async function prepareSmartV2PreviewAction(projectId: string, overwrite: boolean, targetId: string | null = null): Promise<{ ok: boolean; entries?: PreviewEntry[]; message?: string }> {
  try {
    const { supabase, panels, identities } = await owned(projectId);
    if (targetId && !panels.some((p) => p.id === targetId)) throw Error("컷을 찾을 수 없습니다.");
    const store = cacheStore(supabase);
    const entries: PreviewEntry[] = [];
    for (const [index, panel] of panels.entries()) {
      const identity = identities[index];
      const target = { id: panel.id, updatedAt: panel.updated_at, imageRowId: identity.imageRowId, storagePath: identity.storagePath };
      const original = smartPanel(panel), source = panelLayoutSource(original);
      if (targetId && targetId !== panel.id || !canArrangeV2(original, visualImageKey(identity), overwrite)) {
        entries.push({ target, analysis: "NOT_NEEDED", result: { status: "SKIPPED_MANUAL", panel: original, source, avoided: [], reason: "기존 배치 보호 또는 이번 적용 대상 아님" } });
        continue;
      }
      const started = Date.now();
      const analyzer = createGeminiVisualAnalyzer({ onAttempt: (event) => console.info("[smart-layout-visual-attempt]", {
        projectId, panelId: panel.id, imageRowId: identity.imageRowId, provider: "gemini", model: VISUAL_ANALYSIS_MODEL,
        attempt: event.attempt, httpStatus: event.httpStatus, providerStatus: event.providerStatus,
        failureCode: event.failureCode, retry: event.retry, latencyMs: event.latencyMs,
      }) });
      const analysis = await getOrAnalyzeVisual(identity, store, analyzer, async () => {
        const { data, error } = await supabase.storage.from(BUCKET).download(identity.storagePath);
        if (error || !data) throw Error("원본 이미지를 읽지 못했습니다.");
        return new Uint8Array(await data.arrayBuffer());
      }, prepareVisualImage);
      console.info("[smart-layout-visual]", { projectId, panelId: panel.id, imageRowId: identity.imageRowId,
        status: analysis.status, cacheHit: analysis.status === "CACHED", provider: "gemini", model: VISUAL_ANALYSIS_MODEL,
        latencyMs: Date.now() - started, regionCount: analysis.regions?.length ?? 0,
        failureCode: analysis.failureCode, attempts: analysis.attempts });
      entries.push({ target, analysis: analysis.status, failureCode: analysis.failureCode,
        summary: analysis.regions ? summarizeVisualRegions(analysis.regions) : undefined, result: analysis.regions
        ? smartLayoutV2(original, analysis.regions, overwrite, visualImageKey(identity))
        : { status: "REVIEW_REQUIRED", panel: original, source, avoided: [], reason: "이미지 분석 실패", reasonCode: "ANALYSIS_FAILED" } });
    }
    return { ok: true, entries };
  } catch { return { ok: false, message: "자동 배치 미리보기를 준비하지 못했습니다." }; }
}

/** Recalculate only from validated cache and current DB; never invoke Vision at apply time. */
export async function applySmartV2Action(projectId: string, targets: Target[], overwrite: boolean): Promise<{ ok: boolean; message: string; count?: number }> {
  if (inFlight.has(projectId)) return { ok: false, message: "이미 자동 배치를 적용 중입니다." };
  inFlight.add(projectId);
  try {
    const { supabase, panels, identities } = await owned(projectId);
    if (!targets.length || new Set(targets.map((t) => t.id)).size !== targets.length) throw Error("대상 정보가 올바르지 않습니다.");
    const store = cacheStore(supabase);
    const updates: { panel: ToonPanel; result: VisualResult }[] = [];
    for (const target of targets) {
      const index = panels.findIndex((p) => p.id === target.id && p.updated_at === target.updatedAt);
      if (index < 0 || identities[index].imageRowId !== target.imageRowId || identities[index].storagePath !== target.storagePath) throw Error("이미지 또는 컷이 변경됐습니다. 다시 미리보기를 확인해주세요.");
      const cached = validCachedAnalysis(await store.read(visualCachePath(identities[index])), identities[index]);
      if (!cached) throw Error("분석 cache가 변경됐습니다. 다시 미리보기를 확인해주세요.");
      const result = smartLayoutV2(smartPanel(panels[index]), cached.regions, overwrite, visualImageKey(identities[index]));
      if (result.status === "REVIEW_REQUIRED") throw Error("검토가 필요한 컷은 자동 저장할 수 없습니다.");
      if (result.status === "PASS" || result.status === "PASS_WITH_WARNING") {
        const valid = panels[index].panel_type === "cover" ? validateCoverTitleBubble(result.panel.coverTitleBubble).valid
          : validateToonDialogue(result.panel.dialogue).valid && validateNarrationBubble(result.panel.narrationBubble).valid;
        if (!valid) throw Error("배치 검증에 실패했습니다.");
        updates.push({ panel: panels[index], result });
      }
    }
    const saved: { panel: ToonPanel; updatedAt: string }[] = [];
    try {
      for (const { panel, result } of updates) {
        const values = panel.panel_type === "cover" ? { cover_title_bubble: result.panel.coverTitleBubble }
          : { dialogue: result.panel.dialogue, narration_bubble: result.panel.narrationBubble };
        const { data, error } = await supabase.from("toon_panels").update(values).eq("id", panel.id).eq("project_id", projectId)
          .eq("updated_at", panel.updated_at).select("id,updated_at");
        if (error || data?.length !== 1) throw Error("write failed");
        saved.push({ panel, updatedAt: data[0].updated_at });
      }
    } catch {
      let failed = false;
      for (const { panel, updatedAt } of saved.reverse()) {
        const { data, error } = await supabase.from("toon_panels").update(layoutSnapshot(panel)).eq("id", panel.id)
          .eq("project_id", projectId).eq("updated_at", updatedAt).select("id");
        if (error || data?.length !== 1) failed = true;
      }
      if (failed) console.error("[smart-layout-v2] rollback incomplete", { projectId, count: saved.length });
      return { ok: false, message: failed ? "일부 배치를 되돌리지 못했습니다. 편집기에서 확인해주세요." : "저장 실패로 이번 배치를 되돌렸습니다." };
    }
    revalidatePath(`/toon/projects/${projectId}/editor`);
    return { ok: true, message: `${updates.length}개 컷의 Smart Layout v2 배치를 저장했습니다.`, count: updates.length };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "자동 배치를 저장하지 못했습니다." }; }
  finally { inFlight.delete(projectId); }
}
