"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/account/server";
import { getOutfitRecommender } from "@/lib/outfit/server";
import { isEventKind, isFormality } from "@/lib/outfit/situations";
import { REJECTION_REASONS, type RejectionReason } from "@/lib/outfit/tuning";
import { formDate, noticeParams } from "./home-state";

async function requireUserId() {
  const user = await getAccount().getCurrentUser(await headers());
  if (!user) redirect("/?next=/home");
  return user.id;
}

// Back to the same date and 일정 on the home screen, and to the 추천 세션
// `sessionId` when there is one to go on with.
function backHome(formData: FormData, sessionId: string | null, extra: [string, string][] = []): never {
  const params = new URLSearchParams({ date: formDate(formData) });
  const situation = formData.get("situation");
  if (isEventKind(situation)) params.set("situation", situation);
  if (sessionId) params.set("session", sessionId);
  for (const [name, value] of extra) params.append(name, value);
  redirect(`/home?${params}`);
}

// 거절, then 다시 추천받기: the next 코디 not shown yet for the date, as the
// plain "shown" list in the URL has always done.
export async function rejectOutfit(formData: FormData) {
  const userId = await requireUserId();
  const reason = String(formData.get("reason") ?? "");
  await getOutfitRecommender().reject({
    userId,
    date: formDate(formData),
    clothingIds: formData.getAll("clothing").map(String),
    reason: REJECTION_REASONS.includes(reason as RejectionReason) ? (reason as RejectionReason) : null,
  });
  backHome(
    formData,
    null,
    formData.getAll("shown").map((value) => ["shown", String(value)]),
  );
}

// The 추천 세션 the form was sent from, if any.
function sessionFrom(formData: FormData) {
  const sessionId = formData.get("session");
  return typeof sessionId === "string" && sessionId ? sessionId : null;
}

function requireSession(formData: FormData) {
  const sessionId = sessionFrom(formData);
  if (!sessionId) throw new Error("Invalid 추천 세션");
  return sessionId;
}

// 대화로 수정하기, then back to the 추천 세션 to show the 수정 결과, or why the
// message changed nothing.
export async function reviseOutfit(formData: FormData) {
  const userId = await requireUserId();
  const sessionId = requireSession(formData);
  const message = String(formData.get("message") ?? "").trim();
  if (!message) backHome(formData, sessionId);
  const revised = await getOutfitRecommender().revise({ userId, sessionId, message });
  backHome(formData, sessionId, noticeParams(revised));
}

// 되돌리기 to an earlier step of the 추천 세션.
export async function undoRevision(formData: FormData) {
  const userId = await requireUserId();
  const sessionId = requireSession(formData);
  const step = Number(formData.get("step"));
  await getOutfitRecommender().undo({ userId, sessionId, step });
  backHome(formData, sessionId);
}

// 입을게요, then back to the same 추천 세션.
export async function acceptOutfit(formData: FormData) {
  const userId = await requireUserId();
  const clothingIds = formData.getAll("clothing").map(String);
  await getOutfitRecommender().accept({
    userId,
    date: formDate(formData),
    clothingIds,
    sessionId: sessionFrom(formData) ?? undefined,
  });
  backHome(formData, sessionFrom(formData));
}

// 일정 판단 직접 고치기, then back to the 추천 세션, which goes on with a 코디
// chosen with it; or, without one to go on, to the date for a new 추천.
export async function correctEvent(formData: FormData) {
  const userId = await requireUserId();
  const eventId = formData.get("eventId");
  const kind = formData.get("kind");
  const formality = formData.get("formality");
  if (typeof eventId !== "string" || !eventId || !isEventKind(kind) || !isFormality(formality)) {
    throw new Error("Invalid 일정 correction");
  }
  const continued = await getOutfitRecommender().correctEvent({
    userId,
    eventId,
    judgement: { kind, formality },
    sessionId: sessionFrom(formData) ?? undefined,
  });
  backHome(formData, continued?.sessionId ?? null);
}

// 수락 취소, then back to the same 추천 세션.
export async function cancelAcceptance(formData: FormData) {
  const userId = await requireUserId();
  await getOutfitRecommender().cancelAcceptance({ userId, date: formDate(formData) });
  backHome(formData, sessionFrom(formData));
}
