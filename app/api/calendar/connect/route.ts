import { connection, NextResponse, type NextRequest } from "next/server";
import { getAccount } from "@/lib/account/server";

// Starts 캘린더 연동: sends the browser to Google's consent screen.
export async function GET(request: NextRequest) {
  await connection();
  const account = getAccount();
  if (!(await account.getCurrentUser(request.headers))) {
    return NextResponse.redirect(new URL("/?next=/settings", request.url));
  }
  const returnTo = request.nextUrl.searchParams.get("returnTo") === "/home" ? "/home" : "/settings";
  return NextResponse.redirect(await account.startCalendarConnection(request.headers, returnTo));
}
