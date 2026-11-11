// The 옷장 module: 옷 등록 from a photo the AI fills in and the user confirms,
// the 옷장 itself, and showing its photos to their owner only. Photos live in
// the 사진 저장소 under each user's own prefix; what the AI says is checked
// against the value lists like anything else from outside.
import { randomUUID } from "node:crypto";
import type { ClothingSighting, ClothingVision, Photo, PhotoStorage } from "./closet-ports";
import {
  COLORS,
  ESTIMATED_WEAR_FREQUENCIES,
  FORMALITIES,
  MATERIALS,
  SEASONS,
  SLOTS,
  STYLES,
  WARMTHS,
  type Clothing,
  type ClothingFields,
  type EstimatedWearFrequency,
  type Wardrobe,
} from "./wardrobe";

export type { ClothingSighting, ClothingVision, Photo, PhotoStorage } from "./closet-ports";

// A 등록 초안: the photo kept for it and what the AI filled in, each field
// null where it was unsure. With analysis "failed" every field is null.
export type Draft = ClothingSighting["clothing"];
export type AnalysedPhoto = {
  photoId: string;
  analysis: "done" | "failed";
  looksLikeClothing: boolean;
  draft: Draft;
};

export type RegisterRequest = {
  photoId: string;
  clothing: ClothingFields;
  estimatedWearFrequency: EstimatedWearFrequency;
};

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
// How long a photo URL keeps working.
const PHOTO_URL_SECONDS = 5 * 60;

const EMPTY_DRAFT: Draft = {
  name: null,
  slot: null,
  color: null,
  seasons: null,
  style: null,
  formality: null,
  warmth: null,
  material: null,
};

export function createCloset({
  wardrobe,
  photos,
  vision,
}: {
  wardrobe: Wardrobe;
  photos: PhotoStorage;
  vision: ClothingVision;
}) {
  // Photo ids are ours (UUIDs), and every key sits under its owner's prefix,
  // so a user can only ever name their own photos.
  const photoKey = (userId: string, photoId: string) => {
    if (!/^[0-9a-f-]{36}$/.test(photoId)) throw new Error("Not a photo id");
    return `${userPrefix(userId)}${photoId}.jpg`;
  };

  return {
    // 사진 분석하기: keeps the photo for the user and asks the AI what it is.
    async analyzePhoto(userId: string, photo: Photo): Promise<AnalysedPhoto> {
      if (!PHOTO_TYPES.includes(photo.contentType)) throw new Error("Only JPEG, PNG or WebP photos");
      if (photo.bytes.byteLength > MAX_PHOTO_BYTES) throw new Error("Photos must be at most 5MB");
      const photoId = randomUUID();
      await photos.put(photoKey(userId, photoId), photo);
      try {
        const { looksLikeClothing, clothing } = await vision.look(photo);
        return { photoId, analysis: "done", looksLikeClothing, draft: checkedDraft(clothing) };
      } catch (error) {
        console.error("Could not analyse the clothing photo", error);
        return { photoId, analysis: "failed", looksLikeClothing: true, draft: EMPTY_DRAFT };
      }
    },

    // 등록하기: the confirmed piece, with the photo the user analysed for it.
    async register(userId: string, { photoId, clothing, estimatedWearFrequency }: RegisterRequest): Promise<Clothing> {
      const fields = checkedFields(clothing);
      if (!ESTIMATED_WEAR_FREQUENCIES.includes(estimatedWearFrequency)) {
        throw new Error("Unknown 추정 착용 빈도");
      }
      const key = photoKey(userId, photoId);
      if (!(await photos.exists(key))) throw new Error("No such photo for this user");
      return wardrobe.addClothing(userId, fields, { photoKey: key, estimatedWearFrequency });
    },

    // 옷장 보기.
    clothes: (userId: string) => wardrobe.clothes(userId),

    // 사진 주소 얻기: a short-lived URL for the owner's photo, else null.
    async photoURL(userId: string, clothingId: string): Promise<string | null> {
      const key = await wardrobe.photoKey(userId, clothingId);
      return key && photos.readURL(key, PHOTO_URL_SECONDS);
    },

    // 탈퇴: every photo the user ever uploaded, registered or only analysed.
    // Their rows go with the user; the photos are not in the database.
    async removeAllPhotos(userId: string) {
      await photos.removeAll(userPrefix(userId));
    },
  };
}

export type Closet = ReturnType<typeof createCloset>;

function userPrefix(userId: string) {
  return `users/${userId}/clothing/`;
}

const oneOf = <T>(values: readonly T[], value: unknown): T | null =>
  values.includes(value as T) ? (value as T) : null;

// The AI's answer with anything outside the value lists taken as unsure.
function checkedDraft(clothing: Draft): Draft {
  const seasons = Array.isArray(clothing.seasons) ? clothing.seasons : [];
  const name = typeof clothing.name === "string" ? clothing.name.trim() : "";
  return {
    name: name || null,
    slot: oneOf(SLOTS, clothing.slot),
    color: oneOf(COLORS, clothing.color),
    seasons:
      seasons.length > 0 && seasons.every((season) => SEASONS.includes(season)) ? [...seasons] : null,
    style: oneOf(STYLES, clothing.style),
    formality: oneOf(FORMALITIES, clothing.formality),
    warmth: oneOf(WARMTHS, clothing.warmth),
    material: oneOf(MATERIALS, clothing.material),
  };
}

// The user's confirmed fields, refused unless every one is filled and valid.
function checkedFields(clothing: ClothingFields): ClothingFields {
  const draft = checkedDraft(clothing);
  const missing = Object.entries(draft)
    .filter(([, value]) => value === null)
    .map(([field]) => field);
  if (missing.length > 0) throw new Error(`Missing or invalid: ${missing.join(", ")}`);
  return draft as ClothingFields;
}
