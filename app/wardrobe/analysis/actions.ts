"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/account/server";
import { ANSWERS, type Answer } from "@/lib/outfit/analysis-store";
import { getCloset, getPieceSuggestions, getWardrobeAnalysis } from "@/lib/outfit/server";

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

// 다른 옷 보기 on the main screen card.
export async function showAnotherWeeklyPick() {
  const userId = await requireUserId();
  await getWardrobeAnalysis().showAnotherPick(userId);
  redirect("/home");
}

// Back to where an 이 한 벌 제안 card was: its analysis page or the main screen.
function backFromSuggestion(formData: FormData): never {
  const returnTo = String(formData.get("returnTo") ?? "");
  redirect(returnTo.startsWith("/wardrobe/analysis/") || returnTo === "/home" ? returnTo : "/wardrobe/analysis");
}

// 이 한 벌 제안의 "되돌려 보세요": back from the 정리한 옷.
export async function restoreSuggestedClothing(formData: FormData) {
  const userId = await requireUserId();
  await getCloset().restore(userId, String(formData.get("clothingId")));
  backFromSuggestion(formData);
}

// 이 한 벌 제안의 "관심 없어요".
export async function dismissPieceSuggestion(formData: FormData) {
  const userId = await requireUserId();
  await getPieceSuggestions().dismiss(userId, String(formData.get("suggestionId")));
  backFromSuggestion(formData);
}

// 정리 제안에서 바로 정리하기.
export async function tidyFromAnalysis(formData: FormData) {
  const userId = await requireUserId();
  await getCloset().tidy(userId, String(formData.get("clothingId")));
  redirect("/wardrobe/analysis");
}
