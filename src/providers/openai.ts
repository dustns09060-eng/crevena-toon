import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import type { CharacterBible, SceneDefinition } from "../types";
import { buildScenePrompt } from "./promptBuilder";

export const OPENAI_MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
const MODEL = OPENAI_MODEL;

/**
 * 이 환경의 네트워크에서 openai SDK(node-fetch, chunked transfer-encoding)로
 * 큰 멀티파트 바디를 보내면 ECONNRESET이 발생한다(curl은 Content-Length를
 * 먼저 계산해 보내므로 문제 없음). 그래서 멀티파트 바디를 직접 버퍼로
 * 만들어 Content-Length를 명시하고 Node의 https 모듈로 직접 전송한다.
 */
function buildMultipartBody(
  fields: Record<string, string>,
  files: { fieldName: string; filename: string; contentType: string; data: Buffer }[]
): { body: Buffer; boundary: string } {
  const boundary = `----instatoon-${Date.now().toString(16)}`;
  const parts: Buffer[] = [];

  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
      )
    );
  }

  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.fieldName}"; filename="${f.filename}"\r\nContent-Type: ${f.contentType}\r\n\r\n`
      )
    );
    parts.push(f.data);
    parts.push(Buffer.from("\r\n"));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), boundary };
}

function postMultipart(apiKey: string, body: Buffer, boundary: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.openai.com",
        path: "/v1/images/edits",
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf-8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`OpenAI API 오류 (${res.statusCode}): ${responseBody.slice(0, 800)}`));
            return;
          }
          try {
            const json = JSON.parse(responseBody);
            const b64 = json?.data?.[0]?.b64_json;
            if (!b64) {
              reject(new Error(`OpenAI 응답에 이미지 데이터가 없습니다: ${responseBody.slice(0, 500)}`));
              return;
            }
            resolve(Buffer.from(b64, "base64"));
          } catch {
            reject(new Error(`OpenAI 응답 파싱 실패: ${responseBody.slice(0, 500)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function generateWithOpenAI(
  characters: CharacterBible[],
  scene: SceneDefinition
): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다 (.env 확인)");

  const referencePaths = [...new Set(characters.flatMap((c) => c.reference_images))];
  const files = referencePaths.map((p, i) => ({
    fieldName: "image[]",
    filename: `reference-${i}${path.extname(p) || ".jpg"}`,
    contentType: "image/jpeg",
    data: fs.readFileSync(p),
  }));

  const prompt = buildScenePrompt(characters, scene);

  const { body, boundary } = buildMultipartBody(
    { model: MODEL, prompt, size: "1024x1024" },
    files
  );

  return postMultipart(apiKey, body, boundary);
}

export interface ReferenceImageBytes {
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * STEP 4 — 이미 완성된 프롬프트 문자열 + 메모리상의 참조 이미지
 * 바이트로 이미지를 생성하는 범용 진입점 (gemini.ts의
 * generateImageFromPrompt와 대응). 로컬 파일 경로 기반인
 * generateWithOpenAI() 대신 STEP 3~4의 DB/Storage 흐름에서 쓴다.
 */
export async function generateImageFromPrompt(
  prompt: string,
  referenceImages: ReferenceImageBytes[]
): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다 (.env 확인)");

  const files = referenceImages.map((img, i) => ({
    fieldName: "image[]",
    filename: `reference-${i}.${img.mimeType.split("/")[1] || "jpg"}`,
    contentType: img.mimeType,
    data: Buffer.from(img.bytes),
  }));

  const { body, boundary } = buildMultipartBody({ model: MODEL, prompt, size: "1024x1024" }, files);

  return postMultipart(apiKey, body, boundary);
}
