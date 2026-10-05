import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToonPanel } from "../../src/db/types";
import type { EditorPanelData } from "./editor";
import { getDefaultBubbleForIndex, getDefaultCoverTitleBubble, getDefaultNarrationBubble } from "../editor/bubbleLayout";

/** Shape already authorized panel rows without re-reading the project or panels. */
export async function prepareEditorPanels(supabase: SupabaseClient, panels: ToonPanel[]): Promise<EditorPanelData[]> {
  const PANELS_BUCKET = "toon-panels";
  // Storage can sign the whole approved raw set in one request. The Editor
  // needs URLs for later panel switches, but does not need one HTTP round trip
  // per panel during its initial server render.
  const rawPaths = [...new Set(panels.map((panel) => panel.raw_image_url).filter((path): path is string => typeof path === "string" && path.length > 0))];
  const signedUrls = new Map<string, string>();
  if (rawPaths.length > 0) {
    const { data } = await supabase.storage.from(PANELS_BUCKET).createSignedUrls(rawPaths, 3600);
    for (const signed of data ?? []) {
      if (signed.path && signed.signedUrl) signedUrls.set(signed.path, signed.signedUrl);
    }
  }

  const panelData: EditorPanelData[] = [];
  for (const panel of panels) {
    const signedUrl = panel.raw_image_url ? signedUrls.get(panel.raw_image_url) ?? null : null;

    const dialogue = panel.dialogue.map((item, index) => ({
      ...item,
      bubble: item.bubble ?? getDefaultBubbleForIndex(index),
    }));
    const narrationBubble = panel.narration_bubble ?? (panel.narration ? getDefaultNarrationBubble() : null);
    const coverTitleBubble =
      panel.panel_type === "cover" && panel.cover_title ? (panel.cover_title_bubble ?? getDefaultCoverTitleBubble()) : null;

    panelData.push({
      id: panel.id,
      panelNumber: panel.panel_number,
      panelType: panel.panel_type,
      rawImageSignedUrl: signedUrl,
      hasFinalImage: Boolean(panel.image_url),
      hasStoredLayout: panel.panel_type === "cover" ? Boolean(panel.cover_title_bubble) : panel.dialogue.some((item) => Boolean(item.bubble)) || Boolean(panel.narration_bubble),
      updatedAt: panel.updated_at,
      dialogue,
      narration: panel.narration,
      narrationBubble,
      coverTitle: panel.cover_title,
      coverSubtitle: panel.cover_subtitle,
      coverTitleBubble,
    });
  }

  return panelData;
}
