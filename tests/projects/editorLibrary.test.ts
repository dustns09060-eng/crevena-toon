import { beforeEach, expect, test, vi } from "vitest";
const state=vi.hoisted(()=>({owner:"u",signedIn:true,writes:[] as string[],removed:[] as string[],files:[] as {name:string}[],uploadError:false}));
vi.mock("../../lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:state.signedIn?{id:"u"}:null}})},storage:{from:()=>({
 upload:async(path:string)=>{state.writes.push(path);return {error:state.uploadError?Error("offline"):null};},
 list:async()=>({data:state.files,error:null}),remove:async(paths:string[])=>{state.removed.push(...paths);return {error:null};},
 download:async()=>({data:new Blob(["{}"]),error:null}),
})}})}));
vi.mock("../../lib/projects/service",()=>({getProject:async()=>({id:projectId,user_id:state.owner,status:"confirmed"}),getProjectPanels:async()=>[{id:"panel"}]}));
import { saveEditorVersion, loadEditorVersion, saveWorkStyle } from "../../lib/projects/editorLibrary";
const projectId="11111111-1111-4111-8111-111111111111";
const draft=JSON.stringify({version:1,projectId,savedAt:1,panels:[{id:"panel",updatedAt:"date",dialogue:[],narration:null,narrationBubble:null,coverTitle:"test",coverSubtitle:null,coverTitleBubble:null}]});
beforeEach(()=>{state.owner="u";state.signedIn=true;state.writes=[];state.removed=[];state.files=[];state.uploadError=false;});
test("rejects anonymous and foreign project backup before storage writes",async()=>{
 state.signedIn=false;expect((await saveEditorVersion(projectId,draft)).ok).toBe(false);
 state.signedIn=true;state.owner="other";expect((await saveEditorVersion(projectId,draft)).ok).toBe(false);
 expect(state.writes).toEqual([]);
});
test("valid backup uses owner/project namespace and never shares mutable latest file",async()=>{
 expect((await saveEditorVersion(projectId,draft)).ok).toBe(true);
 expect((await saveEditorVersion(projectId,draft)).ok).toBe(true);
 expect(state.writes[0]).toContain(`u/${projectId}/editor-versions/`);
 expect(state.writes[0]).not.toBe(state.writes[1]);
});
test("rejects path traversal and panel from another project",async()=>{
 expect((await loadEditorVersion(projectId,"../../other.json")).ok).toBe(false);
 expect((await saveEditorVersion(projectId,draft.replace('"panel"','"foreign"'))).ok).toBe(false);
 expect(state.writes).toEqual([]);
});
test("failed upload leaves history untouched; retention removes only old version JSON",async()=>{
 state.files=Array.from({length:22},(_,i)=>({name:`${String(1791195214000-i)}-11111111-1111-4111-8111-111111111111.json`}));
 state.uploadError=true;expect((await saveEditorVersion(projectId,draft)).ok).toBe(false);expect(state.removed).toEqual([]);
 state.uploadError=false;expect((await saveEditorVersion(projectId,draft)).ok).toBe(true);expect(state.removed).toHaveLength(2);
 expect(state.removed.every(p=>p.startsWith(`u/${projectId}/editor-versions/`))).toBe(true);
});
test("style has bounded count and validated layout",async()=>{
 expect((await saveWorkStyle(projectId,JSON.stringify({version:1,name:"x",dialogue:{x:99},cover:null,narration:null}))).ok).toBe(false);
 expect(state.writes).toEqual([]);
 expect((await saveWorkStyle(projectId,JSON.stringify({version:1,name:"기본",dialogue:null,cover:null,narration:null}))).ok).toBe(true);
 expect(state.writes[0]).toContain("u/work-styles/");
});

