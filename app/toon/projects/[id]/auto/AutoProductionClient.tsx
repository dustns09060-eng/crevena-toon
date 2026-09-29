"use client";
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { advanceAutoProduction, getAutoProductionState, getAutoRenderInput } from '../../../../../lib/projects/autoProduction';
import { saveBubbleLayoutAction, saveCoverLayoutAction, saveFinalRenderAction } from '../../../../../lib/projects/editor';
import { canvasToPngBlob, fetchAsObjectUrl, renderPanelToCanvas, FONT_FAMILY } from '../../../../../lib/editor/renderPanel';

type State = Awaited<ReturnType<typeof getAutoProductionState>>;
function requireSuccess(result: { ok: boolean; message?: string }) { if (!result.ok) throw new Error(result.message ?? '저장에 실패했습니다.'); }
export default function AutoProductionClient({ projectId, initial }: { projectId: string; initial: State }) {
  const [state, setState] = useState(initial);
  const [running, setRunning] = useState(false);
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState('');
  const stop = useRef(false), busy = useRef(false);
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);
  useEffect(() => () => { stop.current = true; }, []);
  async function run() {
    if (busy.current || !consent) return;
    busy.current = true; stop.current = false; setRunning(true); setMessage('');
    try {
      if (!navigator.locks) throw new Error('최신 Chrome 또는 Safari 브라우저에서 실행해주세요.');
      await navigator.locks.request(`toon-auto-${projectId}`, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('다른 탭에서 이 프로젝트를 제작 중입니다.');
        while (!stop.current) {
          const current = await getAutoProductionState(projectId); setState(current);
          if (!current.ok) throw new Error(current.message);
          const step = current.step;
          if (step.kind === 'done') { setMessage('완성본이 저장되었습니다.'); break; }
          if (step.kind === 'render') {
            const { panel, dimensions } = await getAutoRenderInput(projectId, step.panelId);
            await document.fonts.load(`16px ${FONT_FAMILY}`); await document.fonts.ready;
            const url = await fetchAsObjectUrl(panel.rawImageSignedUrl!);
            try {
              const canvas = document.createElement('canvas');
              await renderPanelToCanvas(canvas, { ...panel, ...dimensions, imageObjectUrl: url });
              const blob = await canvasToPngBlob(canvas);
              if (panel.panelType === 'cover') requireSuccess(await saveCoverLayoutAction(panel.id, panel.coverTitle, panel.coverSubtitle, panel.coverTitleBubble));
              else requireSuccess(await saveBubbleLayoutAction(panel.id, panel.dialogue, panel.narration, panel.narrationBubble));
              requireSuccess(await saveFinalRenderAction(panel.id, new File([blob], `panel-${panel.panelNumber}.png`, { type: 'image/png' })));
            } finally { URL.revokeObjectURL(url); }
          } else requireSuccess(await advanceAutoProduction(projectId));
        }
        if (stop.current) setMessage('현재 단계까지 저장하고 멈췄습니다. 이어서 제작할 수 있습니다.');
        setState(await getAutoProductionState(projectId));
      });
    } catch (e) { setMessage(e instanceof Error ? e.message : '제작 중 오류가 발생했습니다. 이어서 제작을 눌러주세요.'); }
    finally { busy.current = false; setRunning(false); }
  }
  const finished = state.ok && state.step.kind === 'done';
  const label = !state.ok ? state.message : ({ story: '대본 생성 및 저장', confirm: '스토리보드 확정', image: '이미지 생성 및 선택', render: '말풍선·자막 합성 및 저장', complete: '완성 처리', done: '제작 완료' })[state.step.kind];
  return <section className="card" style={{ padding: 20 }}>
    <h2>스토리부터 완성본까지</h2>
    <p>저장된 소재로 대본 → 컷 이미지 → 말풍선·자막 → 완성본을 순서대로 제작합니다.</p>
    <p>저장된 대본과 승인된 이미지는 유지합니다. 승인 전 후보가 있으면 해당 이미지를 자동 선택합니다. 없는 이미지만 새로 생성합니다.</p>
    <p>제작 중에는 이 화면을 열어두세요. 중단 후 다시 열면 저장된 단계부터 이어집니다. 다른 기기나 편집 화면에서 같은 프로젝트를 동시에 수정하지 마세요.</p>
    <div aria-live="polite"><strong>{running ? '진행 중: ' : '다음 단계: '}{label}</strong>
      {state.ok && <p>이미지 {state.images}/{state.total}컷 · 완성본 {state.renders}/{state.total}컷</p>}
      {state.ok && <progress aria-label="완성본 저장 진행률" value={state.renders} max={state.total} style={{ width: '100%' }} />}
    </div>
    {!finished && <><label style={{ display: 'flex', gap: 8, margin: '20px 0' }}><input type="checkbox" checked={consent} disabled={running} onChange={e => setConsent(e.target.checked)} />AI 사용 요금 발생 및 대본 확정·이미지 자동 선택에 동의합니다.</label>
      <button className="btn btn-primary" type="button" disabled={!consent || running} onClick={run}>자동 제작 시작 / 이어서 제작</button>
      {running && <button className="btn" type="button" onClick={() => { stop.current = true; setMessage('현재 요청을 저장한 뒤 멈춥니다.'); }}>현재 단계 후 멈추기</button>}</>}
    {message && <p role="status">{message}</p>}
    {!running && <p><Link href={`/toon/projects/${projectId}`}>스토리보드로 돌아가기</Link> · <Link href={`/toon/projects/${projectId}/images`}>이미지 확인</Link>{finished && <> · <Link href={`/toon/projects/${projectId}/final`}>완성본 보기 / 다운로드</Link></>}</p>}
    <p>자동 배치된 말풍선과 이미지 품질은 게시 전에 확인해주세요. 필요하면 기존 편집기에서 수정할 수 있습니다.</p>
  </section>;
}
