import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { CHARACTERS, getCharacter } from "./characters.js";
import { SCENES } from "./scenes.js";
import { generateWithGemini } from "./providers/gemini.js";
import { generateWithOpenAI } from "./providers/openai.js";
import type { GenerationResult, ProviderId } from "./types.js";

// 2025-09 기준 공개 가격표를 참고한 러프 추정치(USD/장). 실제 청구액은 계정 대시보드에서 확인 필요.
const ESTIMATED_COST_USD: Record<ProviderId, number> = {
  gemini: 0.039,
  openai: 0.07,
};

const OUTPUT_DIR = path.resolve("output");

async function withRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        console.warn(`  재시도 중... (${attempt + 1}/${retries})`);
      }
    }
  }
  throw lastErr;
}

async function runProvider(provider: ProviderId): Promise<GenerationResult[]> {
  const results: GenerationResult[] = [];
  const providerDir = path.join(OUTPUT_DIR, provider);
  fs.mkdirSync(providerDir, { recursive: true });

  for (const scene of SCENES) {
    const characters = scene.character_ids.map(getCharacter);
    const outputPath = path.join(providerDir, `${scene.scene_id}.png`);
    const start = Date.now();
    console.log(`[${provider}] ${scene.scene_id} (${scene.title_ko}) 생성 중...`);

    try {
      const buffer = await withRetry(() =>
        provider === "gemini"
          ? generateWithGemini(characters, scene)
          : generateWithOpenAI(characters, scene)
      );
      fs.writeFileSync(outputPath, buffer);
      const duration_ms = Date.now() - start;
      console.log(`  완료 (${duration_ms}ms) -> ${outputPath}`);
      results.push({
        provider,
        scene_id: scene.scene_id,
        success: true,
        output_path: path.relative(process.cwd(), outputPath),
        duration_ms,
        estimated_cost_usd: ESTIMATED_COST_USD[provider],
      });
    } catch (err) {
      const duration_ms = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  실패 (${duration_ms}ms): ${message}`);
      results.push({
        provider,
        scene_id: scene.scene_id,
        success: false,
        duration_ms,
        error: message,
      });
    }
  }
  return results;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`캐릭터 ${CHARACTERS.length}명, 장면 ${SCENES.length}개 x 프로바이더 2개 = ${SCENES.length * 2}회 생성 시작\n`);

  const geminiResults = await runProvider("gemini");
  const openaiResults = await runProvider("openai");
  const allResults = [...geminiResults, ...openaiResults];

  const logPath = path.join(OUTPUT_DIR, "generation-log.json");
  fs.writeFileSync(logPath, JSON.stringify(allResults, null, 2), "utf-8");

  const successCount = allResults.filter((r) => r.success).length;
  const totalCost = allResults.reduce((sum, r) => sum + (r.estimated_cost_usd ?? 0), 0);
  console.log(`\n완료: ${successCount}/${allResults.length}건 성공`);
  console.log(`예상 총 비용: 약 $${totalCost.toFixed(3)} USD (러프 추정치)`);
  console.log(`로그 저장: ${logPath}`);
  console.log(`\n다음: npm run report 실행 후 output/report.html 확인`);
}

main().catch((err) => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
