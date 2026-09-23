import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server Component / Server Action에서 사용하는 Supabase 클라이언트.
 * anon key + 요청 쿠키의 세션으로 동작하므로 RLS가 그대로 적용된다
 * (service_role을 여기서 절대 쓰지 않는다 — 그건 STEP 검증 스크립트
 * 전용이며 이 앱 코드에는 포함되지 않는다).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component에서 호출되면 set이 실패할 수 있다 —
            // middleware가 세션 갱신을 이미 처리하므로 무시해도 된다.
          }
        },
      },
    }
  );
}
