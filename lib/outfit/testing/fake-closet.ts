import type { ClothingSighting, ClothingVision, Photo, PhotoStorage } from "../closet-ports";
import type { ClothingFields } from "../wardrobe";

// The 사진 저장소 in memory. Read URLs name the key and when they expire, so
// tests can tell which photo a URL is for.
export class FakePhotoStorage implements PhotoStorage {
  private photos = new Map<string, Photo>();

  async put(key: string, photo: Photo) {
    this.photos.set(key, photo);
  }

  async exists(key: string) {
    return this.photos.has(key);
  }

  async remove(key: string) {
    this.photos.delete(key);
  }

  async removeAll(prefix: string) {
    for (const key of this.keys()) if (key.startsWith(prefix)) this.photos.delete(key);
  }

  async readURL(key: string, expiresInSeconds: number) {
    return `https://photos.test/${key}?expires-in=${expiresInSeconds}`;
  }

  keys() {
    return [...this.photos.keys()];
  }
}

// The AI that looks at photos, answering what the test prepared: by default
// it is unsure of everything.
export class FakeClothingVision implements ClothingVision {
  private next: ClothingSighting | null = null;
  private failure: Error | null = null;
  looked: Photo[] = [];

  // The next photo looks like `clothing`; fields left out are ones it is unsure of.
  willSee({
    looksLikeClothing = true,
    clothing = {},
  }: {
    looksLikeClothing?: boolean;
    clothing?: Partial<ClothingFields>;
  }) {
    this.next = {
      looksLikeClothing,
      clothing: {
        name: null,
        slot: null,
        color: null,
        seasons: null,
        style: null,
        formality: null,
        warmth: null,
        material: null,
        ...clothing,
      },
    };
  }

  failWith(error = new Error("the vision model is down")) {
    this.failure = error;
  }

  async look(photo: Photo): Promise<ClothingSighting> {
    this.looked.push(photo);
    if (this.failure) throw this.failure;
    const sighting = this.next;
    this.next = null;
    if (!sighting) throw new Error("No sighting prepared for this photo");
    return sighting;
  }
}
