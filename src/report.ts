import fs from "node:fs";
import path from "node:path";
import { SCENES } from "./scenes.js";
import type { GenerationResult } from "./types.js";

const OUTPUT_DIR = path.resolve("output");
const LOG_PATH = path.join(OUTPUT_DIR, "generation-log.json");
const REPORT_PATH = path.join(OUTPUT_DIR, "report.html");

const CRITERIA = [
  "얼굴 특징",
  "헤어스타일",
  "머리색",
  "연령감",
  "체형",
  "캐릭터 간 구분",
  "대표 의상",
  "전체 그림체",
  "컷 간 동일 인물 인식 가능 여부",
];

function cell(provider: "gemini" | "openai", sceneId: string, results: GenerationResult[]) {
  const result = results.find((r) => r.provider === provider && r.scene_id === sceneId);
  const relPath = `${provider}/${sceneId}.png`;
  const absExists = fs.existsSync(path.join(OUTPUT_DIR, provider, `${sceneId}.png`));

  if (!result?.success || !absExists) {
    return `<div class="cell fail"><div class="ph">생성 실패</div><div class="err">${
      result?.error ? escapeHtml(result.error) : "결과 없음"
    }</div></div>`;
  }
  return `<div class="cell">
    <img src="${relPath}" alt="${provider} ${sceneId}" loading="lazy" />
    <div class="meta">${result.duration_ms}ms · 예상 $${(result.estimated_cost_usd ?? 0).toFixed(3)}</div>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function checklistRow() {
  return CRITERIA.map(
    (c) => `<tr><td>${c}</td><td class="pick">PASS / WARN / FAIL</td></tr>`
  ).join("\n");
}

function main() {
  if (!fs.existsSync(LOG_PATH)) {
    console.error(`generation-log.json이 없습니다. 먼저 npm run generate를 실행하세요.`);
    process.exit(1);
  }
  const results: GenerationResult[] = JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));

  const sceneSections = SCENES.map((scene) => {
    return `
    <section class="scene">
      <h2>${scene.scene_id} — ${scene.title_ko}</h2>
      <div class="row">
        <div class="col">
          <h3>Gemini 2.5 Flash Image</h3>
          ${cell("gemini", scene.scene_id, results)}
        </div>
        <div class="col">
          <h3>OpenAI gpt-image-1</h3>
          ${cell("openai", scene.scene_id, results)}
        </div>
      </div>
      <details>
        <summary>이 장면 평가 체크리스트 (직접 기입)</summary>
        <table>
          <thead><tr><th>평가 항목</th><th>판정</th></tr></thead>
          <tbody>${checklistRow()}</tbody>
        </table>
      </details>
    </section>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<title>인스타툰 캐릭터 일관성 PoC 리포트</title>
<style>
  body { font-family: -apple-system, "Malgun Gothic", sans-serif; max-width: 1100px; margin: 40px auto; padding: 0 20px; background: #fafafa; color: #222; }
  h1 { font-size: 24px; }
  .scene { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-bottom: 24px; background: #fff; }
  .row { display: flex; gap: 16px; }
  .col { flex: 1; }
  .cell img { width: 100%; border-radius: 6px; border: 1px solid #eee; }
  .cell.fail { display:flex; flex-direction:column; align-items:center; justify-content:center; height:200px; background:#fff0f0; border:1px dashed #f5a; border-radius:6px; }
  .meta { font-size: 12px; color: #888; margin-top: 4px; }
  .err { font-size: 12px; color: #c00; padding: 0 8px; text-align:center; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 14px; }
  td, th { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
  .pick { color: #666; }
  summary { cursor: pointer; margin-top: 8px; font-weight: 600; }
</style>
</head>
<body>
  <h1>인스타툰 캐릭터 일관성 PoC — 비교 리포트</h1>
  <p>생성 시각: ${new Date().toISOString()}</p>
  <p>각 장면 아래 체크리스트를 펼쳐 PASS / WARN / FAIL을 직접 판정해 최종 보고서에 반영하세요.</p>
  ${sceneSections}
</body>
</html>`;

  fs.writeFileSync(REPORT_PATH, html, "utf-8");
  console.log(`리포트 생성 완료: ${REPORT_PATH}`);
}

main();
