import { getAccount } from "@/lib/account/server";

export const GET = (request: Request) => getAccount().handler(request);
export const POST = GET;
