export interface AutoPanel { id: string; panel_number: number; raw_image_url: string | null; image_url: string | null }
export type AutoStep = { kind: 'story' | 'confirm' | 'complete' | 'done' } | { kind: 'image' | 'render'; panelId: string; number: number };
export function nextAutoStep(status: string, expectedCount: number, panels: AutoPanel[]): AutoStep {
  if (status === 'completed') return { kind: 'done' };
  if (!panels.length) return { kind: 'story' };
  if (panels.length !== expectedCount || panels.some((p, i) => p.panel_number !== i + 1)) throw new Error('저장된 컷 구성을 먼저 스토리보드에서 확인해주세요.');
  if (status !== 'confirmed') return { kind: 'confirm' };
  const missingImage = panels.find(p => !p.raw_image_url);
  if (missingImage) return { kind: 'image', panelId: missingImage.id, number: missingImage.panel_number };
  const missingRender = panels.find(p => !p.image_url);
  if (missingRender) return { kind: 'render', panelId: missingRender.id, number: missingRender.panel_number };
  return { kind: 'complete' };
}
