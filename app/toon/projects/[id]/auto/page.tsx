import { notFound, redirect } from 'next/navigation';
import { createClient } from '../../../../../lib/supabase/server';
import { getProject } from '../../../../../lib/projects/service';
import { getAutoProductionState } from '../../../../../lib/projects/autoProduction';
import AutoProductionClient from './AutoProductionClient';
export default async function AutoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/toon/login');
  const project = await getProject(supabase, id);
  if (!project) notFound();
  return <main className="page"><h1>{project.title} · 자동 제작</h1><AutoProductionClient projectId={id} initial={await getAutoProductionState(id)} /></main>;
}
