import { describe, expect, test } from "vitest";
import { createTestOutfit } from "./testing/harness";
import type { ClothingFields } from "./wardrobe";

const NAVY_KNIT: ClothingFields = {
  name: "네이비 니트",
  slot: "top",
  color: "navy",
  seasons: ["autumn", "winter"],
  style: "minimal",
  formality: "semi-formal",
  warmth: 3,
  material: "knit",
};

// A small JPEG-looking upload; the fakes never decode it.
function photo(bytes = [0xff, 0xd8, 0xff, 0xe0]) {
  return { bytes: new Uint8Array(bytes), contentType: "image/jpeg" };
}

// 민지, whose photo of a navy knit the AI has analysed.
async function minjiWithAnalysedKnit() {
  const outfit = await createTestOutfit();
  const minji = await outfit.createUser("minji@gmail.com");
  outfit.vision.willSee({ clothing: NAVY_KNIT });
  const { photoId } = await outfit.closet.analyzePhoto(minji, photo());
  return { ...outfit, minji, photoId };
}

describe("옷 등록: 사진 분석하기", () => {
  test("analysing a photo gives a draft filled from what the AI saw", async () => {
    const { closet, vision, createUser } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    vision.willSee({ looksLikeClothing: true, clothing: NAVY_KNIT });

    const analysed = await closet.analyzePhoto(minji, photo());

    expect(analysed).toEqual({
      photoId: expect.any(String),
      analysis: "done",
      looksLikeClothing: true,
      draft: NAVY_KNIT,
    });
  });
});

describe("옷 등록: AI가 모를 때", () => {
  test("when the AI fails, the photo is kept and the draft is empty for the user to fill", async () => {
    const { closet, vision, photos, createUser } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    vision.failWith();

    const analysed = await closet.analyzePhoto(minji, photo());

    expect(analysed).toMatchObject({ analysis: "failed", draft: { name: null, color: null } });
    expect(photos.keys()).toHaveLength(1);
  });

  test("a photo without clothing is flagged", async () => {
    const { closet, vision, createUser } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    vision.willSee({ looksLikeClothing: false });

    expect(await closet.analyzePhoto(minji, photo())).toMatchObject({ looksLikeClothing: false });
  });

  test("whatever the AI says outside the value lists is left empty", async () => {
    const { closet, vision, createUser } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    vision.willSee({
      clothing: { ...NAVY_KNIT, color: "teal", seasons: ["autumn", "monsoon"], warmth: 7 } as never,
    });

    const { draft } = await closet.analyzePhoto(minji, photo());

    expect(draft).toMatchObject({ name: "네이비 니트", color: null, seasons: null, warmth: null });
  });

  test("only images of at most 5MB are taken", async () => {
    const { closet, createUser } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");

    await expect(
      closet.analyzePhoto(minji, { bytes: new Uint8Array(4), contentType: "application/pdf" }),
    ).rejects.toThrow();
    await expect(
      closet.analyzePhoto(minji, { bytes: new Uint8Array(5 * 1024 * 1024 + 1), contentType: "image/jpeg" }),
    ).rejects.toThrow();
  });
});

describe("옷 등록: 확인하고 저장", () => {
  test("registering puts the piece in the 옷장 with its photo", async () => {
    const { closet, minji, photoId } = await minjiWithAnalysedKnit();

    const knit = await closet.register(minji, {
      photoId,
      clothing: { ...NAVY_KNIT, name: "엄마가 사 준 니트" },
      estimatedWearFrequency: "rarely",
    });

    expect(await closet.clothes(minji)).toEqual([
      {
        id: knit.id,
        ...NAVY_KNIT,
        name: "엄마가 사 준 니트",
        hasPhoto: true,
        estimatedWearFrequency: "rarely",
      },
    ]);
  });

  test("a registered piece is used from the next 추천", async () => {
    const { closet, recommender, addClothes, minji, photoId } = await minjiWithAnalysedKnit();
    await addClothes(minji, [
      { name: "청바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);

    const knit = await closet.register(minji, { photoId, clothing: NAVY_KNIT, estimatedWearFrequency: "weekly" });
    const recommendation = await recommender.recommendForDate({
      userId: minji,
      date: "2026-11-12",
      situation: null,
      location: { latitude: 37.5665, longitude: 126.978 },
    });

    expect(recommendation).toMatchObject({ outfit: { top: { id: knit.id } } });
  });

  test("someone else's photo cannot be registered", async () => {
    const { closet, createUser, photoId } = await minjiWithAnalysedKnit();
    const jun = await createUser("jun@gmail.com");

    await expect(
      closet.register(jun, { photoId, clothing: NAVY_KNIT, estimatedWearFrequency: "weekly" }),
    ).rejects.toThrow();
    expect(await closet.clothes(jun)).toEqual([]);
  });

  test("values outside the lists, or missing ones, are refused", async () => {
    const { closet, minji, photoId } = await minjiWithAnalysedKnit();

    for (const clothing of [
      { ...NAVY_KNIT, color: "teal" },
      { ...NAVY_KNIT, seasons: [] },
      { ...NAVY_KNIT, name: "  " },
    ]) {
      await expect(
        closet.register(minji, { photoId, clothing: clothing as never, estimatedWearFrequency: "weekly" }),
      ).rejects.toThrow();
    }
    await expect(
      closet.register(minji, { photoId, clothing: NAVY_KNIT, estimatedWearFrequency: "daily" as never }),
    ).rejects.toThrow();
    expect(await closet.clothes(minji)).toEqual([]);
  });
});

describe("사진 보기", () => {
  test("the owner gets a URL that works for 5 minutes; nobody else gets one", async () => {
    const { closet, createUser, addClothes, minji, photoId } = await minjiWithAnalysedKnit();
    const knit = await closet.register(minji, { photoId, clothing: NAVY_KNIT, estimatedWearFrequency: "weekly" });
    const jun = await createUser("jun@gmail.com");
    const [seeded] = await addClothes(minji, [{ name: "시드 셔츠", slot: "top" }]);

    expect(await closet.photoURL(minji, knit.id)).toMatch(/^https:\/\/photos\.test\/users\/.+\?expires-in=300$/);
    expect(await closet.photoURL(jun, knit.id)).toBeNull();
    expect(await closet.photoURL(minji, seeded.id)).toBeNull();
  });
});

describe("탈퇴", () => {
  test("removing a user's photos removes every one of theirs, registered or not, and no one else's", async () => {
    const { closet, vision, photos, createUser, minji, photoId } = await minjiWithAnalysedKnit();
    await closet.register(minji, { photoId, clothing: NAVY_KNIT, estimatedWearFrequency: "weekly" });
    vision.willSee({ clothing: NAVY_KNIT });
    await closet.analyzePhoto(minji, photo());
    const jun = await createUser("jun@gmail.com");
    vision.willSee({ clothing: NAVY_KNIT });
    await closet.analyzePhoto(jun, photo());

    await closet.removeAllPhotos(minji);

    expect(photos.keys()).toEqual([expect.stringContaining(`users/${jun}/`)]);
  });
});

describe("선호 색상·스타일", () => {
  test("saved preferences are read back and steer the next 추천", async () => {
    const { closet, recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, redTop] = await addClothes(minji, [
      { name: "검정 티", slot: "top", color: "black" },
      { name: "빨간 티", slot: "top", color: "red" },
      { name: "청바지", slot: "bottom", color: "navy" },
      { name: "운동화", slot: "shoes", color: "white" },
    ]);

    await closet.setPreferences(minji, { colors: ["red"], styles: ["street"] });

    expect(await closet.preferences(minji)).toEqual({ colors: ["red"], styles: ["street"] });
    const recommendation = await recommender.recommendForDate({
      userId: minji,
      date: "2026-11-12",
      situation: null,
      location: { latitude: 37.5665, longitude: 126.978 },
    });
    expect(recommendation).toMatchObject({ outfit: { top: { id: redTop.id } } });
  });

  test("colors and styles outside the lists are refused", async () => {
    const { closet, createUser } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");

    await expect(closet.setPreferences(minji, { colors: ["teal" as never], styles: [] })).rejects.toThrow();
    await expect(closet.setPreferences(minji, { colors: [], styles: ["gothic" as never] })).rejects.toThrow();
    expect(await closet.preferences(minji)).toEqual({ colors: [], styles: [] });
  });
});
