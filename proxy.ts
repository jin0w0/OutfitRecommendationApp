import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: no session cookie means no way in. The pages verify
// the session for real through the account module.
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();

  const intro = new URL("/", request.url);
  intro.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(intro);
}

export const config = {
  // Everything except the intro page, auth callbacks and static files.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.).+)"],
};
