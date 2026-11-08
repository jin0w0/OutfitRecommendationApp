"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/account/server";
import { getOutfitRecommender } from "@/lib/outfit/server";
import { isEventKind, isFormality } from "@/lib/outfit/situations";

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

// Back to the same date and 일정 on the home screen, and to the same 추천 세션
// when the form names one.
function backHome(formData: FormData, date: string, extra: Record<string, string> = {}): never {
  const params = new URLSearchParams({ date });
  const situation = formData.get("situation");
  if (isEventKind(situation)) params.set("situation", situation);
  const session = formData.get("session");
  if (typeof session === "string" && session) params.set("session", session);
  for (const [name, value] of Object.entries(extra)) params.set(name, value);
  redirect(`/home?${params}`);
}

// 대화로 수정하기, then back to the 추천 세션 to show the 수정 결과.
export async function reviseOutfit(formData: FormData) {
  const userId = await requireUserId();
  const date = dateFrom(formData);
  const sessionId = formData.get("session");
  const message = String(formData.get("message") ?? "").trim();
  if (typeof sessionId !== "string" || !sessionId) throw new Error("Invalid 추천 세션");
  if (!message) backHome(formData, date);
  const revised = await getOutfitRecommender().revise({ userId, sessionId, message });
  // The session keeps no step for a message the LLM could not read, so say so here.
  backHome(formData, date, revised.missing.includes("revision-llm-failed") ? { revisionFailed: "1" } : {});
}

// 입을게요
export async function acceptOutfit(formData: FormData) {
  const userId = await requireUserId();
  const date = dateFrom(formData);
  const clothingIds = formData.getAll("clothing").map(String);
  await getOutfitRecommender().accept({ userId, date, clothingIds });
  backHome(formData, date);
}

// 일정 판단 직접 고치기, then back to the date for a 코디 chosen with it.
export async function correctEvent(formData: FormData) {
  const userId = await requireUserId();
  const date = dateFrom(formData);
  const eventId = formData.get("eventId");
  const kind = formData.get("kind");
  const formality = formData.get("formality");
  if (typeof eventId !== "string" || !eventId || !isEventKind(kind) || !isFormality(formality)) {
    throw new Error("Invalid 일정 correction");
  }
  await getOutfitRecommender().correctEvent({ userId, eventId, judgement: { kind, formality } });
  backHome(formData, date);
}

// 수락 취소
export async function cancelAcceptance(formData: FormData) {
  const userId = await requireUserId();
  const date = dateFrom(formData);
  await getOutfitRecommender().cancelAcceptance({ userId, date });
  backHome(formData, date);
}
