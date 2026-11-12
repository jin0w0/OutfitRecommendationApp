"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/account/server";
import { ANSWERS, type Answer } from "@/lib/outfit/analysis-store";
import { getCloset, getWardrobeAnalysis } from "@/lib/outfit/server";

async function requireUserId() {
  const requestHeaders = await headers();
  const user = await getAccount().getCurrentUser(requestHeaders);
  if (!user) redirect("/?next=/wardrobe/analysis");
  return user.id;
}

// Back to the same card on the 옷장 분석.
function backTo(clothingId: string): never {
  redirect(`/wardrobe/analysis#${clothingId}`);
}

export async function answerAboutClothing(formData: FormData) {
  const userId = await requireUserId();
  const clothingId = String(formData.get("clothingId"));
  const answer = String(formData.get("answer"));
  if (!ANSWERS.includes(answer as Answer)) backTo(clothingId);
  await getWardrobeAnalysis().answer(userId, clothingId, answer as Answer);
  backTo(clothingId);
}

export async function keepClothingAsIs(formData: FormData) {
  const userId = await requireUserId();
  await getWardrobeAnalysis().keepAsIs(userId, String(formData.get("clothingId")));
  redirect("/wardrobe/analysis");
}

// 정리 제안에서 바로 정리하기.
export async function tidyFromAnalysis(formData: FormData) {
  const userId = await requireUserId();
  await getCloset().tidy(userId, String(formData.get("clothingId")));
  redirect("/wardrobe/analysis");
}
