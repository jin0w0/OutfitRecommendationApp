"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/account/server";
import { getOutfitRecommender } from "@/lib/outfit/server";
import { isEventKind } from "@/lib/outfit/situations";

async function requireUserId() {
  const user = await getAccount().getCurrentUser(await headers());
  if (!user) redirect("/?next=/home");
  return user.id;
}

function dateFrom(formData: FormData) {
  const date = String(formData.get("date"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date");
  return date;
}

// Back to the same date and 일정 on the home screen.
function backHome(formData: FormData, date: string): never {
  const params = new URLSearchParams({ date });
  const situation = formData.get("situation");
  if (isEventKind(situation)) params.set("situation", situation);
  redirect(`/home?${params}`);
}

// 입을게요
export async function acceptOutfit(formData: FormData) {
  const userId = await requireUserId();
  const date = dateFrom(formData);
  const clothingIds = formData.getAll("clothing").map(String);
  await getOutfitRecommender().accept({ userId, date, clothingIds });
  backHome(formData, date);
}

// 수락 취소
export async function cancelAcceptance(formData: FormData) {
  const userId = await requireUserId();
  const date = dateFrom(formData);
  await getOutfitRecommender().cancelAcceptance({ userId, date });
  backHome(formData, date);
}
