// The 옷장 module's ports: where photos are kept and the AI that looks at them,
// as the adapters (real and fake) implement them.
import type { ClothingFields } from "./wardrobe";

// An uploaded photo.
export type Photo = { bytes: Uint8Array; contentType: string };

// The 사진 저장소 어댑터: a private bucket of photos by key.
export type PhotoStorage = {
  put(key: string, photo: Photo): Promise<void>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  // Every photo whose key starts with `prefix`.
  removeAll(prefix: string): Promise<void>;
  // A URL that reads the photo for `expiresInSeconds`, then stops working.
  readURL(key: string, expiresInSeconds: number): Promise<string>;
};

// What the AI made of a photo: whether a piece of clothing is in it, and the
// fields it could tell. A field it was unsure of is null.
export type ClothingSighting = {
  looksLikeClothing: boolean;
  clothing: { [K in keyof ClothingFields]: ClothingFields[K] | null };
};

// The 사진 분석 AI 어댑터. Rejects when the photo could not be analysed.
export type ClothingVision = {
  look(photo: Photo): Promise<ClothingSighting>;
};
