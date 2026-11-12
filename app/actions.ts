"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/account/server";
import { getCloset, getOutfitRecommender } from "@/lib/outfit/server";
import { GENDERS, type Gender, type Preferences } from "@/lib/outfit/wardrobe";

export async function signOut() {
  const requestHeaders = await headers();
  await getAccount().signOut(requestHeaders);
  redirect("/");
}

export async function signOutEverywhere() {
  const requestHeaders = await headers();
  await getAccount().signOutEverywhere(requestHeaders);
  redirect("/");
}

export async function saveHomeRegion(formData: FormData) {
  const requestHeaders = await headers();
  await getAccount().setHomeRegion(requestHeaders, String(formData.get("region")));
  const next = formData.get("next");
  redirect(next === "/settings" || next === "/onboarding" ? next : "/home");
}

export async function saveCalendarSelection(formData: FormData) {
  const requestHeaders = await headers();
  const calendarIds = formData.getAll("calendar").map(String);
  await getAccount().selectCalendars(requestHeaders, calendarIds);
  redirect("/settings");
}

export async function skipCalendarInvite() {
  const requestHeaders = await headers();
  await getAccount().dismissCalendarInvite(requestHeaders);
  redirect("/home");
}

export async function disconnectCalendar() {
  const requestHeaders = await headers();
  await getAccount().disconnectCalendar(requestHeaders);
  redirect("/settings");
}

export async function deleteAccount() {
  const requestHeaders = await headers();
  await getAccount().deleteAccount(requestHeaders);
  redirect("/");
}

// The 성별 the preferences form was sent with; it cannot be left out.
function chosenGender(formData: FormData): Gender {
  const gender = formData.get("gender");
  if (!GENDERS.includes(gender as Gender)) throw new Error("The 성별 must be chosen");
  return gender as Gender;
}

// 성별·선호 색상·스타일 저장하기, from onboarding (which it also moves past) or settings.
export async function savePreferences(formData: FormData) {
  const requestHeaders = await headers();
  const account = getAccount();
  const user = await account.getCurrentUser(requestHeaders);
  if (!user) redirect("/");
  const gender = chosenGender(formData);
  // The 옷장 module refuses anything outside the lists.
  await getCloset().setPreferences(user.id, {
    colors: formData.getAll("color").map(String) as Preferences["colors"],
    styles: formData.getAll("style").map(String) as Preferences["styles"],
  });
  await getCloset().setGender(user.id, gender);
  if (formData.get("next") === "/settings") redirect("/settings");
  await account.passPreferencesStep(requestHeaders);
  redirect("/onboarding");
}

// 추천 맞춤 되돌리기.
export async function resetTuning() {
  const requestHeaders = await headers();
  const user = await getAccount().getCurrentUser(requestHeaders);
  if (!user) redirect("/");
  await getOutfitRecommender().resetTuning(user.id);
  redirect("/settings");
}

// 격식 기울기 켜기·끄기.
export async function setTiltOff(formData: FormData) {
  const requestHeaders = await headers();
  const user = await getAccount().getCurrentUser(requestHeaders);
  if (!user) redirect("/");
  await getOutfitRecommender().setTiltOff(user.id, formData.get("off") === "true");
  redirect("/settings");
}

// 건너뛰기 on onboarding skips only the 선호 색상·스타일: the 성별 is saved.
export async function skipPreferences(formData: FormData) {
  const requestHeaders = await headers();
  const account = getAccount();
  const user = await account.getCurrentUser(requestHeaders);
  if (!user) redirect("/");
  await getCloset().setGender(user.id, chosenGender(formData));
  await account.passPreferencesStep(requestHeaders);
  redirect("/onboarding");
}
