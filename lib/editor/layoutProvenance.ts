import type { ToonLayoutSource } from "../../src/db/types";
import type { SmartPanel } from "./smartLayout";

export type ReadLayoutSource = ToonLayoutSource | "LEGACY" | "NONE" | "MIXED";
export function readLayoutSource(layout: { layout_source?: ToonLayoutSource } | null): ReadLayoutSource {
  return !layout ? "NONE" : layout.layout_source ?? "LEGACY";
}

export function panelLayoutSource(panel: Pick<SmartPanel, "panelType" | "coverTitleBubble" | "dialogue" | "narrationBubble">): ReadLayoutSource {
  const sources = panel.panelType === "cover"
    ? [readLayoutSource(panel.coverTitleBubble)]
    : [...panel.dialogue.map((d) => readLayoutSource(d.bubble)), readLayoutSource(panel.narrationBubble)];
  const present = sources.filter((s) => s !== "NONE");
  return !present.length ? "NONE" : present.every((s) => s === present[0]) ? present[0] : "MIXED";
}

export function canAutomaticallyArrange(source: ReadLayoutSource, overwrite = false): boolean {
  return overwrite || source === "NONE" || source === "IMPORT_DEFAULT" || source === "SMART_V1";
}

export function canArrangeV2(panel: Pick<SmartPanel, "panelType" | "coverTitleBubble" | "dialogue" | "narrationBubble">,
  imageKey: string, overwrite = false): boolean {
  const source = panelLayoutSource(panel);
  if (source !== "SMART_V2") return canAutomaticallyArrange(source, overwrite);
  if (overwrite) return true;
  const identities = panel.panelType === "cover" ? [panel.coverTitleBubble?.analysis_identity]
    : [...panel.dialogue.map((item) => item.bubble?.analysis_identity), panel.narrationBubble?.analysis_identity].filter(Boolean);
  return identities.some((value) => value !== imageKey);
}
