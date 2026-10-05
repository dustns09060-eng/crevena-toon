import { z } from "zod";
import { ToonDialogueItemSchema, ToonNarrationBubbleSchema, ToonCoverTitleBubbleSchema } from "../../src/db/validation";
import type { EditorPanelData } from "../projects/editor";
const EditSchema = z.object({
 id:z.string(), updatedAt:z.string(), dialogue:z.array(ToonDialogueItemSchema.extend({text:z.string().max(10000)})).max(100),
 narration:z.string().nullable(), narrationBubble:ToonNarrationBubbleSchema.nullable(),
 coverTitle:z.string().nullable(),coverSubtitle:z.string().nullable(),coverTitleBubble:ToonCoverTitleBubbleSchema.nullable(),
});
const DraftSchema=z.object({version:z.literal(1),projectId:z.string(),savedAt:z.number(),panels:z.array(EditSchema).max(100)});
export type EditorDraft=z.infer<typeof DraftSchema>;
export function editablePanel(p:EditorPanelData) {
 return {id:p.id,updatedAt:p.updatedAt,dialogue:p.dialogue,narration:p.narration,narrationBubble:p.narrationBubble,coverTitle:p.coverTitle,coverSubtitle:p.coverSubtitle,coverTitleBubble:p.coverTitleBubble};
}
export function parseDraft(raw:string|null,projectId:string):EditorDraft|null {
 if(raw && raw.length>2_000_000)return null;
 try { const result=DraftSchema.safeParse(JSON.parse(raw??"null"));return result.success && result.data.projectId===projectId ? result.data : null; } catch {return null;}
}
export function restoreDraft(current:EditorPanelData[],draft:EditorDraft):EditorPanelData[] {
 return current.map(p=>{const saved=draft.panels.find(d=>d.id===p.id);return saved?{...p,...saved,updatedAt:p.updatedAt}:p;});
}
export function resizeRect(rect:{x:number;y:number;width:number;height:number},dx:number,dy:number) {
 return {...rect,width:Math.min(1-rect.x,Math.max(0.06,rect.width+dx)),height:Math.min(1-rect.y,Math.max(0.04,rect.height+dy))};
}

export function changedPanels(current:EditorPanelData[],saved:EditorPanelData[]):Record<string,boolean>{
 const content=(p:EditorPanelData)=>{const {updatedAt: _updatedAt,...edit}=editablePanel(p);return JSON.stringify(edit);};
 return Object.fromEntries(current.map(p=>[p.id,content(p)!==content(saved.find(s=>s.id===p.id)??p)]));
}
