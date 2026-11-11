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

describe("옷장 보기", () => {
  test("a piece can be looked up by its owner only", async () => {
    const { closet, createUser, minji, photoId } = await minjiWithAnalysedKnit();
    const knit = await closet.register(minji, { photoId, clothing: NAVY_KNIT, estimatedWearFrequency: "monthly" });
    const jun = await createUser("jun@gmail.com");

    expect(await closet.clothing(minji, knit.id)).toEqual(knit);
    expect(await closet.clothing(jun, knit.id)).toBeNull();
  });
});

describe("고치기", () => {
  async function minjiWithKnit() {
    const outfit = await minjiWithAnalysedKnit();
    const knit = await outfit.closet.register(outfit.minji, {
      photoId: outfit.photoId,
      clothing: NAVY_KNIT,
      estimatedWearFrequency: "weekly",
    });
    return { ...outfit, knit };
  }

  test("every field and the 추정 착용 빈도 can be changed", async () => {
    const { closet, minji, knit } = await minjiWithKnit();

    await closet.update(minji, knit.id, {
      clothing: { ...NAVY_KNIT, name: "회색 니트", color: "gray", seasons: ["winter"], warmth: 2 },
      estimatedWearFrequency: "rarely",
    });

    expect(await closet.clothing(minji, knit.id)).toEqual({
      ...knit,
      name: "회색 니트",
      color: "gray",
      seasons: ["winter"],
      warmth: 2,
      estimatedWearFrequency: "rarely",
    });
  });

  test("changes outside the lists, or to someone else's piece, are refused", async () => {
    const { closet, createUser, minji, knit } = await minjiWithKnit();
    const jun = await createUser("jun@gmail.com");

    await expect(
      closet.update(minji, knit.id, { clothing: { ...NAVY_KNIT, color: "teal" as never }, estimatedWearFrequency: "weekly" }),
    ).rejects.toThrow();
    await expect(
      closet.update(jun, knit.id, { clothing: { ...NAVY_KNIT, name: "내 니트" }, estimatedWearFrequency: "weekly" }),
    ).rejects.toThrow();
    expect(await closet.clothing(minji, knit.id)).toEqual(knit);
  });

  test("replacing the photo keeps the fields, drops the old photo, and does not ask the AI", async () => {
    const { closet, photos, vision, minji, knit } = await minjiWithKnit();
    const before = await closet.photoURL(minji, knit.id);
    const looked = vision.looked.length;

    await closet.replacePhoto(minji, knit.id, photo([0xff, 0xd8, 9, 9]));

    const after = await closet.photoURL(minji, knit.id);
    expect(after).not.toEqual(before);
    expect(photos.keys()).toHaveLength(1);
    expect(await closet.clothing(minji, knit.id)).toEqual(knit);
    expect(vision.looked).toHaveLength(looked);
  });

  test("someone else's piece cannot get a new photo", async () => {
    const { closet, photos, createUser, knit } = await minjiWithKnit();
    const jun = await createUser("jun@gmail.com");

    await expect(closet.replacePhoto(jun, knit.id, photo())).rejects.toThrow();
    expect(photos.keys()).toHaveLength(1);
  });
});

describe("정리하기", () => {
  const DAY = "2026-11-12";
  const SEOUL_AT = { latitude: 37.5665, longitude: 126.978 };

  // 민지 with two tops, the first of which she will tidy away.
  async function minjiWithTwoTops() {
    const outfit = await createTestOutfit({ today: DAY });
    const minji = await outfit.createUser("minji@gmail.com");
    const [oldTop, otherTop, jeans, sneakers] = await outfit.addClothes(minji, [
      { name: "낡은 티", slot: "top" },
      { name: "새 티", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);
    const recommend = () =>
      outfit.recommender.recommendForDate({ userId: minji, date: DAY, situation: null, location: SEOUL_AT });
    return { ...outfit, minji, oldTop, otherTop, jeans, sneakers, recommend };
  }

  test("a tidied piece leaves the 옷장 for the tidied list, and restoring brings it back", async () => {
    const { closet, minji, oldTop } = await minjiWithTwoTops();

    await closet.tidy(minji, oldTop.id);
    expect((await closet.clothes(minji)).map((c) => c.id)).not.toContain(oldTop.id);
    expect((await closet.tidiedClothes(minji)).map((c) => c.id)).toEqual([oldTop.id]);

    await closet.restore(minji, oldTop.id);
    expect((await closet.clothes(minji)).map((c) => c.id)).toContain(oldTop.id);
    expect(await closet.tidiedClothes(minji)).toEqual([]);
  });

  test("someone else's piece cannot be tidied", async () => {
    const { closet, createUser, minji, oldTop } = await minjiWithTwoTops();
    const jun = await createUser("jun@gmail.com");

    await expect(closet.tidy(jun, oldTop.id)).rejects.toThrow();
    expect((await closet.clothes(minji)).map((c) => c.id)).toContain(oldTop.id);
  });

  test("a tidied piece is in neither a new 추천 nor a revised one", async () => {
    const { closet, recommender, llm, minji, oldTop, otherTop, recommend } = await minjiWithTwoTops();
    expect(await recommend()).toMatchObject({ outfit: { top: { id: oldTop.id } } });

    await closet.tidy(minji, oldTop.id);
    const first = await recommend();
    expect(first).toMatchObject({ outfit: { top: { id: otherTop.id } } });
    llm.interpret("이 티 말고", [{ type: "exclude", clothingId: otherTop.id }]);
    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "이 티 말고" });

    expect(revised.status === "ok" && revised.outfit.top?.id).not.toBe(oldTop.id);
  });

  test("a past 착용 기록 still shows a piece tidied since", async () => {
    const { closet, recommender, minji, oldTop, jeans, sneakers, recommend } = await minjiWithTwoTops();
    await recommender.accept({ userId: minji, date: DAY, clothingIds: [oldTop.id, jeans.id, sneakers.id] });

    await closet.tidy(minji, oldTop.id);

    expect((await recommend()).accepted?.clothes.map((c) => c.id)).toEqual([oldTop.id, jeans.id, sneakers.id]);
  });
});
