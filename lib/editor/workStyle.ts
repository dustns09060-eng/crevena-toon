import { z } from "zod";
import { ToonBubbleSchema, ToonNarrationBubbleSchema, ToonCoverTitleBubbleSchema } from "../../src/db/validation";
import { getDefaultBubbleForIndex, getDefaultNarrationBubble } from "./bubbleLayout";
import type { EditorPanelData } from "../projects/editor";

export const WorkStyleSchema = z.object({
  version: z.literal(1), name: z.string().trim().min(1).max(50),
  dialogue: ToonBubbleSchema.nullable(), narration: ToonNarrationBubbleSchema.nullable(), cover: ToonCoverTitleBubbleSchema.nullable(),
});
export type WorkStyle = z.infer<typeof WorkStyleSchema>;
export function captureStyle(name: string, current: EditorPanelData, panels: EditorPanelData[]): WorkStyle {
  return WorkStyleSchema.parse({version:1,name,dialogue:current.dialogue.find(d=>d.bubble)?.bubble ?? panels.flatMap(p=>p.dialogue).find(d=>d.bubble)?.bubble ?? null,
    narration:current.narrationBubble ?? panels.find(p=>p.narrationBubble)?.narrationBubble ?? null,
    cover:panels.find(p=>p.panelType==="cover")?.coverTitleBubble ?? null});
}
export function applyWorkStyle(panel:EditorPanelData, style:WorkStyle):EditorPanelData {
  // Retain each scene's geometry and content. Only the cover reuses the title layout.
  return {...panel, dialogue:panel.dialogue.map((d,i)=> style.dialogue ? {...d,bubble:{...(d.bubble??getDefaultBubbleForIndex(i)),
    font_size:style.dialogue.font_size,style:style.dialogue.style,opacity:style.dialogue.opacity,
    tail_enabled:style.dialogue.tail_enabled,layout_source:"MANUAL",analysis_identity:undefined}}:d),
    narrationBubble:style.narration ? {...(panel.narrationBubble??getDefaultNarrationBubble()),font_size:style.narration.font_size,
      preset:style.narration.preset,opacity:style.narration.opacity,composition:style.narration.composition,layout_source:"MANUAL",analysis_identity:undefined}:panel.narrationBubble,
    coverTitleBubble:panel.panelType==="cover" && style.cover ? {...style.cover,layout_source:"MANUAL",analysis_identity:undefined}:panel.coverTitleBubble};
}
