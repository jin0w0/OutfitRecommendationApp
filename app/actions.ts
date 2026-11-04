"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/account/server";

export async function signOut() {
  const requestHeaders = await headers();
  await getAccount().signOut(requestHeaders);
  redirect("/");
}
