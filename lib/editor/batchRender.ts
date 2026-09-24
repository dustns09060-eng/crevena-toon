/** Sequential renders avoid 20 simultaneous canvas encodes and keep successful results on retry. */
export async function renderPanelsInOrder<T extends { id: string; panelNumber: number }>(
  panels: T[], completedIds: ReadonlySet<string>, render: (panel: T) => Promise<void>
): Promise<{ completedIds: Set<string>; failed: number[] }> {
  const completed = new Set(completedIds);
  const failed: number[] = [];
  for (const panel of [...panels].sort((a, b) => a.panelNumber - b.panelNumber)) {
    if (completed.has(panel.id)) continue;
    try { await render(panel); completed.add(panel.id); }
    catch { failed.push(panel.panelNumber); }
  }
  return { completedIds: completed, failed };
}
