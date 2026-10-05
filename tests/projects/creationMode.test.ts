import {beforeEach,expect,test,vi} from "vitest";
const mocks=vi.hoisted(()=>({create:vi.fn(),redirect:vi.fn((url:string)=>{throw new Error(url);})}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("next/navigation",()=>({redirect:mocks.redirect}));
vi.mock("../../lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:"owner"}}})}})}));
vi.mock("../../lib/projects/service",()=>({createProject:mocks.create}));
import {createProjectAction} from "../../lib/projects/actions";
beforeEach(()=>{vi.clearAllMocks();mocks.create.mockResolvedValue({id:"new-project"});});
function form(mode:string){const f=new FormData();Object.entries({creation_mode:mode,title:"기능 점검용",topic:"검증",panel_count:"20",character_ids:"11111111-1111-4111-8111-111111111111"}).forEach(([k,v])=>f.set(k,v));return f;}
test("external mode creates an eleven-image project and goes straight to import",async()=>{
 await expect(createProjectAction({ok:true},form("external"))).rejects.toThrow("/toon/projects/new-project/external");
 expect(mocks.create).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({panel_count:11}));
});
test("AI mode keeps the selected panel count and storyboard route",async()=>{
 await expect(createProjectAction({ok:true},form("ai"))).rejects.toThrow("/toon/projects/new-project");
 expect(mocks.redirect).toHaveBeenCalledWith("/toon/projects/new-project");
 expect(mocks.create).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({panel_count:20}));
});
