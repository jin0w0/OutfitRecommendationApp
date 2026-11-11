"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/account/server";
import { getCloset } from "@/lib/outfit/server";
import type { Preferences } from "@/lib/outfit/wardrobe";

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

// 선호 색상·스타일 저장하기, from onboarding (which it also moves past) or settings.
export async function savePreferences(formData: FormData) {
  const requestHeaders = await headers();
  const account = getAccount();
  const user = await account.getCurrentUser(requestHeaders);
  if (!user) redirect("/");
  // The 옷장 module refuses anything outside the lists.
  await getCloset().setPreferences(user.id, {
    colors: formData.getAll("color").map(String) as Preferences["colors"],
    styles: formData.getAll("style").map(String) as Preferences["styles"],
  });
  if (formData.get("next") === "/settings") redirect("/settings");
  await account.passPreferencesStep(requestHeaders);
  redirect("/onboarding");
}

export async function skipPreferences() {
  const requestHeaders = await headers();
  await getAccount().passPreferencesStep(requestHeaders);
  redirect("/onboarding");
}
