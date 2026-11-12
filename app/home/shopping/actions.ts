"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/account/server";
import type { PurchaseRecommendation } from "@/lib/outfit/recommender";
import { getOutfitRecommender } from "@/lib/outfit/server";
import { isEventKind } from "@/lib/outfit/situations";
import { formDate } from "../home-state";

async function requireUserId() {
  const user = await getAccount().getCurrentUser(await headers());
  if (!user) redirect("/?next=/home");
  return user.id;
}

function requireSession(formData: FormData) {
  const sessionId = formData.get("session");
  if (typeof sessionId !== "string" || !sessionId) throw new Error("Invalid 구매 추천 세션");
  return sessionId;
}

// Back to the 구매 추천 세션 on the same date and 일정, with why the last
// message changed nothing, if it did not.
function backToShopping(formData: FormData, sessionId: string, result?: PurchaseRecommendation): never {
  const params = new URLSearchParams({ date: formDate(formData), session: sessionId });
  const situation = formData.get("situation");
  if (isEventKind(situation)) params.set("situation", situation);
  if (result?.unapplied) {
    params.set("notice", result.unapplied.reason);
    if (result.unapplied.reason === "style-limit") params.set("direction", result.unapplied.direction);
  }
  redirect(`/home/shopping?${params}`);
}

// 구매 대화: one message about the 구매 추천 shown.
export async function revisePurchase(formData: FormData) {
  const userId = await requireUserId();
  const sessionId = requireSession(formData);
  const message = String(formData.get("message") ?? "").trim();
  if (!message) backToShopping(formData, sessionId);
  const result = await getOutfitRecommender().revisePurchase({ userId, sessionId, message });
  backToShopping(formData, sessionId, result);
}

// 되돌리기 in 구매 대화.
export async function undoPurchase(formData: FormData) {
  const userId = await requireUserId();
  const sessionId = requireSession(formData);
  await getOutfitRecommender().undoPurchase({ userId, sessionId, step: Number(formData.get("step")) });
  backToShopping(formData, sessionId);
}
