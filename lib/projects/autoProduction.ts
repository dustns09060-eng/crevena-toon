"use server";
import { createClient } from '../supabase/server';
import { getProject, getProjectPanels } from './service';
import { nextAutoStep } from './autoProductionPlan';
import { generateStoryboardAction, saveStoryboardAction, confirmStoryboardAction } from './storyboard';
import { generatePanelImageAction, approvePanelImageAction, getPanelImagesSummary } from './panelImages';
import { getPanelEditorData } from './editor';
import { completeProjectAction } from './finalPage';
import { getFinalImageDimensions } from '../../src/providers/finalImageConfig';

async function ownedState(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  const project = await getProject(supabase, id);
  if (!project) throw new Error('프로젝트를 찾을 수 없거나 접근 권한이 없습니다.');
  const panels = await getProjectPanels(supabase, id);
  return { supabase, project, panels };
}

export async function getAutoProductionState(id: string) {
  try {
    const { project, panels } = await ownedState(id);
    return { ok: true as const, step: nextAutoStep(project.status, project.panel_count, panels), total: project.panel_count,
      images: panels.filter(p => p.raw_image_url).length, renders: panels.filter(p => p.image_url).length };
  } catch (e) { return { ok: false as const, message: e instanceof Error ? e.message : '진행 상태를 확인하지 못했습니다.' }; }
}

// Each request performs only one persisted step. Reopening the page resumes from DB state.
export async function advanceAutoProduction(id: string) {
  try {
    const { supabase, project, panels } = await ownedState(id);
    const step = nextAutoStep(project.status, project.panel_count, panels);
    if (step.kind === 'story') {
      const generated = await generateStoryboardAction(id);
      if (!generated.ok || !generated.draft) return { ok: false as const, message: generated.message ?? '대본을 생성하지 못했습니다.' };
      return await saveStoryboardAction(id, generated.draft);
    }
    if (step.kind === 'confirm') return await confirmStoryboardAction(id);
    if (step.kind === 'image') {
      const panel = panels.find(p => p.id === step.panelId)!;
      const summary = await getPanelImagesSummary(supabase, [panel]);
      let image = summary.approvedByPanel[panel.id] ?? summary.candidateByPanel[panel.id];
      if (!image) {
        const generated = await generatePanelImageAction(panel.id);
        if (!generated.ok || !generated.image) return { ok: false as const, message: generated.message ?? '이미지 생성 실패' };
        image = generated.image;
      }
      return await approvePanelImageAction(panel.id, image.id);
    }
    if (step.kind === 'complete') return await completeProjectAction(id);
    return { ok: true };
  } catch (e) { return { ok: false as const, message: e instanceof Error ? e.message : '자동 제작 중 오류가 발생했습니다.' }; }
}

export async function getAutoRenderInput(id: string, panelId: string) {
  const state = await ownedState(id);
  const next = nextAutoStep(state.project.status, state.project.panel_count, state.panels);
  if (next.kind !== 'render' || next.panelId !== panelId) throw new Error('제작 상태가 변경되었습니다. 이어서 제작을 눌러주세요.');
  const data = await getPanelEditorData(id);
  if (!data.ok) throw new Error(data.readinessErrors.join(' / '));
  const panel = data.panels.find(p => p.id === panelId);
  if (!panel?.rawImageSignedUrl) throw new Error('승인된 이미지를 불러오지 못했습니다.');
  return { panel, dimensions: getFinalImageDimensions() };
}
