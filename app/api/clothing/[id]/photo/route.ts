import { connection, NextResponse, type NextRequest } from "next/server";
import { getAccount } from "@/lib/account/server";
import { getCloset } from "@/lib/outfit/server";

// A piece's photo, for its owner only: a short-lived URL to the private bucket.
export async function GET(request: NextRequest, { params }: RouteContext<"/api/clothing/[id]/photo">) {
  await connection();
  const user = await getAccount().getCurrentUser(request.headers);
  if (!user) return new NextResponse(null, { status: 401 });
  const { id } = await params;
  const url = await getCloset().photoURL(user.id, id);
  if (!url) return new NextResponse(null, { status: 404 });
  const response = NextResponse.redirect(url);
  // The URL itself expires in 5 minutes; keep browsers from reusing it longer.
  response.headers.set("cache-control", "private, max-age=240");
  return response;
}
