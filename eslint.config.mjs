import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// eslint-config-next(15.x)는 아직 legacy(.eslintrc) 형식이라
// FlatCompat으로 감싸야 flat config(eslint.config.mjs)에서 쓸 수 있다.
const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  { ignores: ["dist/**", ".next/**", "node_modules/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // 테스트 코드에서 "_"로 시작하는 이름은 의도적으로 사용하지 않는
      // 구조분해/파라미터임을 나타내는 흔한 관례라 예외로 둔다.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
