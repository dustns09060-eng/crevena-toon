"use server";
import { randomUUID } from "node:crypto";
import { createClient } from "../supabase/server";
import { getProject, getProjectPanels } from "./service";
import { parseDraft } from "../editor/draft";
import { WorkStyleSchema } from "../editor/workStyle";

const bucket = "toon-panels";
async function owned(projectId:string) {
  if(!/^[a-f0-9-]{36}$/i.test(projectId)) throw Error("프로젝트 주소를 확인해주세요.");
  const client=await createClient();
  const {data:{user}}=await client.auth.getUser();
  if(!user) throw Error("로그인이 필요합니다.");
  const project=await getProject(client,projectId);
  if(!project || project.user_id!==user.id) throw Error("접근할 수 없는 프로젝트입니다.");
  return {client,user,project};
}
function message(error:unknown){return error instanceof Error ? error.message : "연결 상태를 확인하고 다시 시도해주세요.";}
const validFile=(name:string)=>/^\d{13}-[a-f0-9-]{36}\.json$/.test(name);
export async function saveEditorVersion(projectId:string,raw:string) {
  try {
    const {client,user,project}=await owned(projectId);
    if(project.status==="completed")throw Error("완성된 프로젝트에는 새 편집 백업을 저장할 수 없습니다.");
    const draft=parseDraft(raw,projectId);
    if(!draft || !draft.panels.length || new Set(draft.panels.map(p=>p.id)).size!==draft.panels.length)throw Error("백업 형식이 올바르지 않습니다.");
    const panels=await getProjectPanels(client,projectId);
    if(draft.panels.some(p=>!panels.some(row=>row.id===p.id)))throw Error("다른 프로젝트의 컷은 저장할 수 없습니다.");
    const prefix=`${user.id}/${projectId}/editor-versions`;
    const name=`${Date.now()}-${randomUUID()}.json`;
    const {error}=await client.storage.from(bucket).upload(`${prefix}/${name}`,JSON.stringify({...draft,savedAt:Date.now()}),{contentType:"application/json",upsert:false});
    if(error)throw Error("클라우드 백업을 저장하지 못했습니다. 다운로드 백업을 이용해주세요.");
    // Keep the latest twenty immutable versions, never remove artwork or database rows.
    const {data}=await client.storage.from(bucket).list(prefix,{limit:100,sortBy:{column:"name",order:"desc"}});
    const old=(data??[]).filter(f=>validFile(f.name)).slice(20).map(f=>`${prefix}/${f.name}`);
    if(old.length)await client.storage.from(bucket).remove(old);
    return {ok:true as const,name};
  } catch(error){return {ok:false as const,message:message(error)};}
}
export async function listEditorVersions(projectId:string) {
  try {
    const {client,user}=await owned(projectId);
    const {data,error}=await client.storage.from(bucket).list(`${user.id}/${projectId}/editor-versions`,{limit:20,sortBy:{column:"name",order:"desc"}});
    if(error)throw Error("이전 버전을 불러오지 못했습니다.");
    return {ok:true as const,versions:(data??[]).filter(f=>validFile(f.name)).map(f=>({name:f.name,savedAt:Number(f.name.slice(0,13))}))};
  }catch(error){return {ok:false as const,message:message(error)};}
}
export async function loadEditorVersion(projectId:string,name:string){
  try {
    if(!validFile(name))throw Error("버전 이름이 올바르지 않습니다.");
    const {client,user}=await owned(projectId);
    const {data,error}=await client.storage.from(bucket).download(`${user.id}/${projectId}/editor-versions/${name}`);
    if(error || !data || data.size>2_000_000)throw Error("백업을 읽지 못했습니다.");
    const draft=parseDraft(await data.text(),projectId);
    if(!draft)throw Error("백업 형식이 올바르지 않습니다.");
    return {ok:true as const,draft};
  }catch(error){return {ok:false as const,message:message(error)};}
}
export async function saveWorkStyle(projectId:string,raw:string){
  try {
    if(raw.length>20_000)throw Error("스타일 정보가 너무 큽니다.");
    const style=WorkStyleSchema.parse(JSON.parse(raw));
    const {client,user}=await owned(projectId);
    const prefix=`${user.id}/work-styles`;
    const {data,error:listError}=await client.storage.from(bucket).list(prefix,{limit:21});
    if(listError)throw Error("스타일 목록을 확인하지 못했습니다.");
    if((data?.length??0)>=20)throw Error("스타일은 최대 20개입니다. 사용하지 않는 스타일을 삭제해주세요.");
    const name=`${Date.now()}-${randomUUID()}.json`;
    const {error}=await client.storage.from(bucket).upload(`${prefix}/${name}`,JSON.stringify(style),{contentType:"application/json",upsert:false});
    if(error)throw Error("스타일을 저장하지 못했습니다.");
    return {ok:true as const};
  }catch(error){return {ok:false as const,message:message(error)};}
}
export async function listWorkStyles(projectId:string){
  try {
    const {client,user}=await owned(projectId);
    const prefix=`${user.id}/work-styles`;
    const {data,error}=await client.storage.from(bucket).list(prefix,{limit:20,sortBy:{column:"name",order:"desc"}});
    if(error)throw Error("스타일 목록을 불러오지 못했습니다.");
    const styles=await Promise.all((data??[]).filter(f=>validFile(f.name)).map(async f=>{
      const {data,error}=await client.storage.from(bucket).download(`${prefix}/${f.name}`);
      if(error || !data || data.size>20_000)throw Error("스타일을 읽지 못했습니다.");
      return {id:f.name,style:WorkStyleSchema.parse(JSON.parse(await data.text()))};
    }));
    return {ok:true as const,styles};
  }catch(error){return {ok:false as const,message:message(error)};}
}
export async function deleteWorkStyle(projectId:string,name:string){
  try {
    if(!validFile(name))throw Error("스타일 이름이 올바르지 않습니다.");
    const {client,user}=await owned(projectId);
    const {error}=await client.storage.from(bucket).remove([`${user.id}/work-styles/${name}`]);
    if(error)throw Error("스타일을 삭제하지 못했습니다.");
    return {ok:true as const};
  }catch(error){return {ok:false as const,message:message(error)};}
}
