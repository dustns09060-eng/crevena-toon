import { describe, it, expect } from 'vitest';
import { nextAutoStep, type AutoPanel } from '../../lib/projects/autoProductionPlan';
const panel = (id: string, n: number, raw: string | null = null, final: string | null = null): AutoPanel => ({ id, panel_number: n, raw_image_url: raw, image_url: final });
describe('automatic production resume plan', () => {
  it('preserves completed projects and saved storyboards', () => {
    expect(nextAutoStep('completed', 2, [])).toEqual({ kind: 'done' });
    expect(nextAutoStep('draft', 2, [])).toEqual({ kind: 'story' });
    expect(nextAutoStep('storyboard', 2, [panel('a',1),panel('b',2)])).toEqual({ kind: 'confirm' });
  });
  it('resumes at missing images without regenerating approved panels', () => {
    expect(nextAutoStep('confirmed',2,[panel('a',1,'raw'),panel('b',2)])).toEqual({ kind:'image',panelId:'b',number:2 });
  });
  it('resumes unfinished renders then marks completion', () => {
    expect(nextAutoStep('confirmed',2,[panel('a',1,'raw','final'),panel('b',2,'raw')])).toEqual({ kind:'render',panelId:'b',number:2 });
    expect(nextAutoStep('confirmed',1,[panel('a',1,'raw','final')])).toEqual({ kind:'complete' });
  });
  it('does not replace partially saved or corrupt storyboards', () => {
    expect(() => nextAutoStep('draft',2,[panel('a',1)])).toThrow();
    expect(() => nextAutoStep('confirmed',1,[panel('a',2)])).toThrow();
  });
});
