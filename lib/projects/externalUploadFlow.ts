/** Executes only after preview confirmation. Cleanup receives this batch's paths, never existing files. */
export async function uploadExternalBatch<T extends { path: string }>(
  uploads: T[],
  upload: (item: T, index: number) => Promise<void>,
  finish: (paths: string[]) => Promise<void>,
  cleanup: (paths: string[]) => Promise<void>
): Promise<void> {
  const paths = uploads.map((item) => item.path);
  try {
    for (const [index, item] of uploads.entries()) await upload(item, index);
    await finish(paths);
  } catch (error) {
    try { await cleanup(paths); }
    catch { throw new Error("업로드 파일 정리에 실패했습니다. 관리자에게 문의해주세요."); }
    throw error;
  }
}
