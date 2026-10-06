"use client";
import { useEffect, useRef, useState } from "react";
import type { EditorPanelData } from "../../../../../lib/projects/editor";
import { editablePanel, type EditorDraft } from "../../../../../lib/editor/draft";
import { captureStyle, type WorkStyle } from "../../../../../lib/editor/workStyle";
import { saveEditorVersion, listEditorVersions, loadEditorVersion, saveWorkStyle, listWorkStyles, deleteWorkStyle } from "../../../../../lib/projects/editorLibrary";

type Props={projectId:string;panels:EditorPanelData[];current:EditorPanelData;dirty:boolean;disabled:boolean;onRestore:(draft:EditorDraft)=>void;onApply:(style:WorkStyle,all:boolean)=>void};
export default function EditorLibrary({projectId,panels,current,dirty,disabled,onRestore,onApply}:Props){
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  const [backupTick,setBackupTick]=useState(0);
  const [name,setName]=useState("");
  const [styles,setStyles]=useState<{id:string;style:WorkStyle}[]>([]);
  const [styleId,setStyleId]=useState("");
  const [versions,setVersions]=useState<{name:string;savedAt:number}[]>([]);
  const [version,setVersion]=useState("");
  const [all,setAll]=useState(false);
  const [auto,setAuto]=useState(true);
  const [autoNotice,setAutoNotice]=useState("편집 후 15초 동안 멈추면 클라우드에 자동 백업합니다.");
  const saving=useRef(false);
  const last=useRef("");
  const content=JSON.stringify(panels.map(editablePanel));
  const latest=useRef(content);latest.current=content;
  const draft=()=>JSON.stringify({version:1,projectId,savedAt:Date.now(),panels:JSON.parse(latest.current)});
  useEffect(()=>{
    if(!auto || !dirty || disabled || busy || last.current===content)return;
    const timer=setTimeout(async()=>{
      if(saving.current)return;
      saving.current=true;setAutoNotice("클라우드에 백업 중…");
      try {
        const result=await saveEditorVersion(projectId,JSON.stringify({version:1,projectId,savedAt:Date.now(),panels:JSON.parse(content)}));
        if(result.ok){last.current=content;setBackupTick(v=>v+1);setAutoNotice(`자동 백업 완료 · ${new Date().toLocaleTimeString("ko-KR")} · 최종 반영은 컷별 저장`);}
        else setAutoNotice(result.message);
      }catch{setAutoNotice("자동 백업 연결 실패 · 다시 편집하거나 ‘지금 백업’을 눌러주세요.");}
      finally{saving.current=false;}
    },15000);
    return()=>clearTimeout(timer);
  },[auto,dirty,disabled,busy,content,projectId,backupTick]);
  async function run(action:()=>Promise<void>){setBusy(true);setNotice("");try{await action();}catch(error){setNotice(error instanceof Error?error.message:"연결 상태를 확인해주세요.");}finally{setBusy(false);}}
  async function refreshStyles(){const result=await listWorkStyles(projectId);if(!result.ok)throw Error(result.message);setStyles(result.styles);setStyleId(result.styles[0]?.id??"");}
  return <details className="card" style={{marginBottom:14}}><summary>작품 스타일 · 자동 백업 · 이전 버전</summary>
    <p className="hint">스타일과 백업은 로그인한 계정에 보관되어 다른 기기에서도 불러올 수 있습니다. 이전 버전은 최근 20개를 보관하며, 이미지가 아닌 대사·배치만 복원합니다.</p>
    <label><input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)}/> 편집 내용 자동 백업</label>
    <p role="status" className="hint">{autoNotice}</p>
    <fieldset disabled={busy||disabled} style={{border:0,padding:0,minWidth:0}}>
      <div className="form-actions" style={{flexWrap:"wrap"}}>
        <button type="button" className="btn" onClick={()=>void run(async()=>{if(saving.current)throw Error("자동 백업이 끝난 뒤 다시 시도해주세요.");const snapshot=draft();const result=await saveEditorVersion(projectId,snapshot);if(!result.ok)throw Error(result.message);last.current=JSON.stringify(JSON.parse(snapshot).panels);setNotice("현재 대사와 배치를 클라우드에 백업했습니다.");})}>지금 백업</button>
        <button type="button" className="btn" onClick={()=>void run(async()=>{const result=await listEditorVersions(projectId);if(!result.ok)throw Error(result.message);setVersions(result.versions);setVersion(result.versions[0]?.name??"");if(!result.versions.length)setNotice("저장된 이전 버전이 없습니다.");})}>이전 버전 조회</button>
      </div>
      {!!versions.length && <div className="field"><label>복원할 버전<select className="input" value={version} onChange={e=>setVersion(e.target.value)}>{versions.map(v=><option key={v.name} value={v.name}>{new Date(v.savedAt).toLocaleString("ko-KR")}</option>)}</select></label><button type="button" className="btn" onClick={()=>void run(async()=>{const result=await loadEditorVersion(projectId,version);if(!result.ok)throw Error(result.message);onRestore(result.draft);setNotice("편집기 위쪽의 복원 확인을 진행해주세요.");})}>선택 버전 복원 확인</button></div>}
      <hr/><h3>내 작품 스타일</h3><p className="hint">현재 컷의 말풍선 모양·글자 크기·투명도, 내레이션 설정과 표지 배치를 저장합니다. 본문 말풍선 위치와 대사 내용은 적용할 때 유지합니다.</p>
      <label>스타일 이름<input className="input" maxLength={50} value={name} placeholder="예: 유별맘 연재 기본" onChange={e=>setName(e.target.value)}/></label>
      <div className="form-actions" style={{flexWrap:"wrap"}}><button type="button" className="btn" disabled={!name.trim()} onClick={()=>void run(async()=>{const result=await saveWorkStyle(projectId,JSON.stringify(captureStyle(name,current,panels)));if(!result.ok)throw Error(result.message);await refreshStyles();setNotice("스타일을 저장했습니다.");})}>현재 스타일 저장</button><button type="button" className="btn" onClick={()=>void run(async()=>{await refreshStyles();setNotice("저장된 스타일 목록을 불러왔습니다.");})}>스타일 불러오기</button></div>
      {!!styles.length && <div className="field"><label>저장된 스타일<select className="input" value={styleId} onChange={e=>setStyleId(e.target.value)}>{styles.map(s=><option key={s.id} value={s.id}>{s.style.name}</option>)}</select></label>
        <label><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)}/> 전체 컷에 적용</label>
        <div className="form-actions" style={{flexWrap:"wrap"}}><button type="button" className="btn" onClick={()=>{const selected=styles.find(s=>s.id===styleId);if(selected){onApply(selected.style,all);setNotice("편집기에 적용했습니다. 미리보기를 확인하고 변경한 컷을 저장해주세요. 실행 취소로 되돌릴 수 있습니다.");}}}>스타일 적용</button>
        <button type="button" className="btn" onClick={()=>{if(window.confirm("선택한 스타일을 보관함에서 삭제할까요? 작품에는 영향이 없습니다."))void run(async()=>{const result=await deleteWorkStyle(projectId,styleId);if(!result.ok)throw Error(result.message);await refreshStyles();});}}>스타일 삭제</button></div>
      </div>}
    </fieldset><p role="status">{notice}</p>
  </details>;
}
