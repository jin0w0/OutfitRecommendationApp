"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/account/server";
import type { AnalysedPhoto } from "@/lib/outfit/closet";
import { getCloset } from "@/lib/outfit/server";
import type { ClothingFields, EstimatedWearFrequency } from "@/lib/outfit/wardrobe";

async function requireUserId() {
  const requestHeaders = await headers();
  const user = await getAccount().getCurrentUser(requestHeaders);
  if (!user) redirect("/?next=/wardrobe/new");
  return user.id;
}

export type AnalyseResult = { ok: true; analysed: AnalysedPhoto } | { ok: false; message: string };

// 사진 분석하기. Refusals (wrong type, too big) come back as a message.
export async function analyseClothingPhoto(formData: FormData): Promise<AnalyseResult> {
  const userId = await requireUserId();
  const file = formData.get("photo");
  if (!(file instanceof File)) return { ok: false, message: "사진을 골라 주세요." };
  try {
    const analysed = await getCloset().analyzePhoto(userId, {
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type,
    });
    return { ok: true, analysed };
  } catch (error) {
    console.error(error);
    return { ok: false, message: "JPEG, PNG, WebP 사진만, 5MB까지 올릴 수 있어요." };
  }
}

export type RegisterResult = { ok: true } | { ok: false; message: string };

// 등록하기. The page moves on to the next photo, or to the 옷장 after the last.
export async function registerClothing(request: {
  photoId: string;
  clothing: ClothingFields;
  estimatedWearFrequency: EstimatedWearFrequency;
}): Promise<RegisterResult> {
  const userId = await requireUserId();
  try {
    await getCloset().register(userId, request);
  } catch (error) {
    console.error(error);
    return { ok: false, message: "모든 항목을 골라 주세요." };
  }
  return { ok: true };
}
