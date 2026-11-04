import { connection, NextResponse, type NextRequest } from "next/server";
import { getAccount } from "@/lib/account/server";

// Google sends the browser back here after the calendar consent screen.
export async function GET(request: NextRequest) {
  await connection();
  const account = getAccount();
  if (!(await account.getCurrentUser(request.headers))) {
    return NextResponse.redirect(new URL("/?next=/settings", request.url));
  }
  const result = await account.completeCalendarConnection(
    request.headers,
    request.nextUrl.searchParams,
  );
  const destination = new URL(result.returnTo, request.url);
  if (result.status !== "connected") destination.searchParams.set("calendar", result.status);
  return NextResponse.redirect(destination);
}
