import { parseDialogueImport, type DialogueImportDocument } from "../projects/dialogueImportUtils";

/** Deterministic conversion: never invent missing dialogue or call an AI provider. */
export function scriptToJson(source: string): string {
  if (source.length > 100_000) throw Error("대본은 10만 자 이내로 입력해주세요.");
  const document: DialogueImportDocument = { cover: { title: "", subtitle: "" }, panels: [] };
  let current: DialogueImportDocument["panels"][number] | undefined;
  const clean = (s: string) => s.trim().replace(/^["“‘]([\s\S]*)["”’]$/, "$1");
  function speech(line: string, number: number) {
    // Split only at a slash followed by a speaker label; slashes within speech survive.
    for (const part of line.split(/\s+\/\s+(?=[^:：\n]{1,60}[:：])/u)) {
      const match = part.match(/^([^:：]{1,60})[:：]\s*(.+)$/u);
      if (!match || !current) throw Error(`${number}번째 줄: '유별: 대사' 또는 '내레이션: 문구'로 입력해주세요.`);
      const speaker = match[1].trim(); const text = clean(match[2]);
      if (/^(내레이션|나레이션|narration)$/i.test(speaker)) current.narration = [current.narration, text].filter(Boolean).join("\n");
      else current.dialogue.push({ speaker, text });
    }
  }
  source.replace(/\r/g, "").split("\n").forEach((raw, index) => {
    const line = raw.trim().replace(/\\$/, "").trim();
    if (!line || /^```/.test(line)) return;
    const header = line.match(/^(표지 제목|표지 부제)\s*[:：]\s*(.*)$/);
    if (header) { document.cover[header[1] === "표지 제목" ? "title" : "subtitle"] = clean(header[2]); return; }
    const start = line.match(/^(\d+)\s*컷\s*(?:\||[:：])?\s*(.*)$/);
    if (start) {
      current = { panel_number: Number(start[1]), dialogue: [], narration: null };
      document.panels.push(current);
      const parts = start[2].split("|");
      // In '1컷 | 장면 | 대사', the scene is reference only and is never rendered as text.
      const text = (parts.length > 1 ? parts.slice(1).join("|") : parts[0]).trim();
      if (text) speech(text, index + 1);
    } else speech(line, index + 1);
  });
  const json = JSON.stringify(document, null, 2);
  const result = parseDialogueImport(json, 20);
  if (!result.ok) throw Error(result.message);
  return json;
}
