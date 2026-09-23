import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * service_role 클라이언트 — RLS를 완전히 우회한다.
 *
 * 오직 신뢰된 서버 전용 코드(Server Action)에서, 그것도 클라이언트에
 * 절대 열어주지 않기로 설계한 좁은 용도(toon_generations 상태 전이 —
 * STEP 1.6/1의 의도적 설계: "pending -> success/failed는 service_role
 * 전용")로만 사용한다. 이 모듈을 클라이언트 컴포넌트에서 import하면
 * `server-only` 패키지가 빌드를 실패시켜 실수 유입을 막는다.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY 또는 SUPABASE URL이 설정되지 않았습니다.");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
