import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  user: vi.fn(), project: vi.fn(), panels: vi.fn(), generateStory: vi.fn(), saveStory: vi.fn(), confirm: vi.fn(),
  generateImage: vi.fn(), approve: vi.fn(), summary: vi.fn(), complete: vi.fn(), editor: vi.fn(),
}));
vi.mock('../../lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: m.user } }) }));
vi.mock('../../lib/projects/service', () => ({ getProject:m.project, getProjectPanels:m.panels }));
vi.mock('../../lib/projects/storyboard', () => ({ generateStoryboardAction:m.generateStory, saveStoryboardAction:m.saveStory, confirmStoryboardAction:m.confirm }));
vi.mock('../../lib/projects/panelImages', () => ({ generatePanelImageAction:m.generateImage, approvePanelImageAction:m.approve, getPanelImagesSummary:m.summary }));
vi.mock('../../lib/projects/finalPage', () => ({ completeProjectAction:m.complete }));
vi.mock('../../lib/projects/editor', () => ({ getPanelEditorData:m.editor }));
import { advanceAutoProduction, getAutoProductionState } from '../../lib/projects/autoProduction';
beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue({data:{user:{id:'owner'}}});
  m.project.mockResolvedValue({id:'project',status:'confirmed',panel_count:1});
  m.panels.mockResolvedValue([{id:'panel',panel_number:1,raw_image_url:null,image_url:null}]);
  m.approve.mockResolvedValue({ok:true});
});
describe('automatic production server boundary', () => {
  it('denies anonymous and inaccessible projects before generating', async () => {
    m.user.mockResolvedValue({data:{user:null}});
    expect((await advanceAutoProduction('project')).ok).toBe(false);
    expect(m.project).not.toHaveBeenCalled();
    m.user.mockResolvedValue({data:{user:{id:'owner'}}});m.project.mockResolvedValue(null);
    expect((await advanceAutoProduction('other')).ok).toBe(false);
    expect(m.generateImage).not.toHaveBeenCalled();
  });
  it('reuses saved candidate after interruption without another paid generation', async () => {
    m.summary.mockResolvedValue({approvedByPanel:{},candidateByPanel:{panel:{id:'candidate'}}});
    expect((await advanceAutoProduction('project')).ok).toBe(true);
    expect(m.generateImage).not.toHaveBeenCalled();
    expect(m.approve).toHaveBeenCalledWith('panel','candidate');
  });
  it('does not approve a failed image generation', async () => {
    m.summary.mockResolvedValue({approvedByPanel:{},candidateByPanel:{}});
    m.generateImage.mockResolvedValue({ok:false,message:'quota'});
    expect(await advanceAutoProduction('project')).toEqual({ok:false,message:'quota'});
    expect(m.approve).not.toHaveBeenCalled();
  });
  it('saves a newly generated storyboard before progressing', async () => {
    m.panels.mockResolvedValue([]);
    const draft={panels:[]};m.generateStory.mockResolvedValue({ok:true,draft});m.saveStory.mockResolvedValue({ok:true});
    expect((await advanceAutoProduction('project')).ok).toBe(true);
    expect(m.saveStory).toHaveBeenCalledWith('project',draft);
    expect(m.confirm).not.toHaveBeenCalled();
  });
  it('leaves completed work untouched', async () => {
    m.project.mockResolvedValue({id:'project',status:'completed',panel_count:1});
    expect((await getAutoProductionState('project')).ok).toBe(true);
    expect((await advanceAutoProduction('project')).ok).toBe(true);
    expect(m.generateStory).not.toHaveBeenCalled();expect(m.generateImage).not.toHaveBeenCalled();expect(m.approve).not.toHaveBeenCalled();
  });
});
