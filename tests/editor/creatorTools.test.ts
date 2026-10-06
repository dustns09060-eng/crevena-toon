import { expect, test } from "vitest";
import { scriptToJson } from "../../lib/editor/scriptImport";
import { applyWorkStyle, captureStyle } from "../../lib/editor/workStyle";
import { getDefaultBubbleForIndex } from "../../lib/editor/bubbleLayout";
import type { EditorPanelData } from "../../lib/projects/editor";

test("converts user's scene pipe format without leaking scene directions into dialogue",()=>{
 const value=JSON.parse(scriptToJson('표지 제목: 실습 도전기\n표지 부제: EP.03\n1컷 | 복도를 걷는다. | 유별: "안녕!" / 내레이션: "첫날이다."\n2컷\n유별: 내일 또 오자.'));
 expect(value.cover).toEqual({title:"실습 도전기",subtitle:"EP.03"});
 expect(value.panels[0]).toEqual({panel_number:1,dialogue:[{speaker:"유별",text:"안녕!"}],narration:"첫날이다."});
 expect(JSON.stringify(value)).not.toContain("복도를 걷는다");
 expect(value.panels[1].dialogue[0].text).toBe("내일 또 오자.");
});
test("rejects ambiguous prose and duplicate panels instead of silently losing it",()=>{
 expect(()=>scriptToJson("그냥 오늘 힘들었어")).toThrow();
 expect(()=>scriptToJson("1컷 | 유별: 안녕\n1컷 | 유별: 또 안녕")).toThrow(/중복/);
 expect(()=>scriptToJson("1컷 | 유별: ")).toThrow();
});
test("preserves slash content and supports colon style and multiple speakers",()=>{
 const doc=JSON.parse(scriptToJson('1컷: 유별: 주/야간 / 별이: 엄마!'));
 expect(doc.panels[0].dialogue.map((d:{text:string})=>d.text)).toEqual(["주/야간","엄마!"]);
});
const panel={id:"p",panelType:"scene",dialogue:[{id:"d",character_id:"c",text:"그대로",bubble_type:"speech",bubble:getDefaultBubbleForIndex(0)}],narration:null,narrationBubble:null,coverTitle:null,coverSubtitle:null,coverTitleBubble:null} as EditorPanelData;
test("style application retains content, speakers and scene geometry; removes stale analysis",()=>{
 const source={...panel,dialogue:[{...panel.dialogue[0],bubble:{...getDefaultBubbleForIndex(0),font_size:40,opacity:.5,x:.3}}]};
 const style=captureStyle("기본",source,[source]);
 const result=applyWorkStyle(panel,style);
 expect(result.dialogue[0]).toMatchObject({text:"그대로",character_id:"c",bubble:{font_size:40,opacity:.5,x:panel.dialogue[0].bubble!.x,layout_source:"MANUAL"}});
 expect(panel.dialogue[0].bubble!.font_size).not.toBe(40);
});
