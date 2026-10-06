import {expect,test} from "vitest";
import {parseDraft,restoreDraft,resizeRect,changedPanels} from "../../lib/editor/draft";
import type {EditorPanelData} from "../../lib/projects/editor";
const panel={id:"p",updatedAt:"new",dialogue:[],narration:null,narrationBubble:null,coverTitle:null,coverSubtitle:null,coverTitleBubble:null,rawImageSignedUrl:"fresh-signed-url"} as unknown as EditorPanelData;
test("draft restores editable data while preserving current signed image URLs",()=>{
 const draft=parseDraft(JSON.stringify({version:1,projectId:"project",savedAt:1,panels:[{...panel,coverTitle:"복구",rawImageSignedUrl:"expired"}]}),"project")!;
 expect(restoreDraft([panel],draft)[0]).toMatchObject({coverTitle:"복구",rawImageSignedUrl:"fresh-signed-url",updatedAt:"new"});
});
test("invalid or another project's draft never restores",()=>{
 expect(parseDraft("{", "p")).toBeNull();expect(parseDraft(JSON.stringify({version:1,projectId:"other",savedAt:1,panels:[]}),"p")).toBeNull();
});
test("resize cannot leave the image or invert its dimensions",()=>{
 expect(resizeRect({x:.8,y:.9,width:.1,height:.1},1,1)).toMatchObject({width:expect.closeTo(.2),height:expect.closeTo(.1)});
 expect(resizeRect({x:.1,y:.1,width:.2,height:.2},-1,-1)).toMatchObject({width:.06,height:.04});
});

test("undo marks only changed panels, without requiring unrelated panels to be re-saved",()=>{
 const second={...panel,id:"other"};
 expect(changedPanels([{...panel,coverTitle:"changed"},second],[panel,second])).toEqual({p:true,other:false});
 expect(changedPanels([panel,second],[panel,second])).toEqual({p:false,other:false});
});

test("restoring parsed backups ignores object property ordering",()=>{
 const bubble={style:"round",height:.1,width:.4,y:.1,x:.1,tail_direction:"none"};
 const original={...panel,dialogue:[{id:"11111111-1111-4111-8111-111111111111",character_id:"22222222-2222-4222-8222-222222222222",text:"대사",bubble_type:"speech",bubble}]} as EditorPanelData;
 const draft=parseDraft(JSON.stringify({version:1,projectId:"project",savedAt:1,panels:[original]}),"project")!;
 expect(changedPanels(restoreDraft([original],draft),[original])).toEqual({p:false});
});
