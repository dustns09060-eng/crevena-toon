import {afterEach,expect,test,vi} from "vitest";
import {renderPanelToCanvas,type RenderPanelInput} from "../../lib/editor/renderPanel";
afterEach(()=>vi.unstubAllGlobals());
function setup(){
 vi.stubGlobal("document",{fonts:{ready:Promise.resolve(),load:async()=>[]}});
 vi.stubGlobal("Image",class {naturalWidth=1080;naturalHeight=1350;onload:()=>void=()=>{};set src(_value:string){queueMicrotask(()=>this.onload());}});
 const values:Record<string,unknown>={measureText:(text:string)=>({width:text.length*20})};
 const ctx=new Proxy(values,{get:(target,key:string)=>target[key]??(()=>{})});
 return {getContext:()=>ctx,width:0,height:0} as unknown as HTMLCanvasElement;
}
const input:RenderPanelInput={imageObjectUrl:"fixture",panelType:"scene",dialogue:[{id:"d",character_id:"c",text:"긴 대사 ".repeat(100),bubble_type:"speech",bubble:{x:.1,y:.1,width:.2,height:.1,tail_direction:"none",font_size:28}}],narration:null,narrationBubble:null,coverTitle:null,coverSubtitle:null,coverTitleBubble:null,width:1080,height:1350};
test("preview flags overflowing text while allowing the box to be edited",async()=>{
 expect((await renderPanelToCanvas(setup(),input)).warnings?.length).toBeGreaterThan(0);
});
test("final rendering rejects overflowing text instead of exporting a broken panel",async()=>{
 await expect(renderPanelToCanvas(setup(),{...input,validateText:true})).rejects.toThrow("상자 밖");
});
test("a short caption renders successfully",async()=>{
 expect((await renderPanelToCanvas(setup(),{...input,dialogue:[{...input.dialogue[0],text:"안녕"}],validateText:true})).warnings).toEqual([]);
});
