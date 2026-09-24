import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getServerRuntimeReadiness } from "../config/runtime";

/** 요청마다 Supabase 세션 쿠키를 갱신한다 (@supabase/ssr 권장 패턴). */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const readiness = getServerRuntimeReadiness();
  if (!readiness.loginReady) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  await supabase.auth.getUser();

  return response;
}
