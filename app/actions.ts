"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/account/server";

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
