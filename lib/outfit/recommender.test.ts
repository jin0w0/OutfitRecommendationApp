import { describe, expect, test } from "vitest";
import { createTestOutfit } from "./testing/harness";

const DATE = "2026-11-10";

describe("recommending an outfit from the 옷장 alone", () => {
  test("the outfit has a top, a bottom and shoes from the user's 옷장", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [tee, jeans, sneakers] = await addClothes(minji, [
      { name: "흰 티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.outfit).toEqual({ top: tee, bottom: jeans, shoes: sneakers });
  });

  test("another user's clothes never appear in the outfit", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const junho = await createUser("junho@gmail.com");
    await addClothes(junho, [
      { name: "준호 셔츠", slot: "top" },
      { name: "준호 바지", slot: "bottom" },
      { name: "준호 구두", slot: "shoes" },
    ]);
    const mine = await addClothes(minji, [
      { name: "민지 티셔츠", slot: "top" },
      { name: "민지 바지", slot: "bottom" },
      { name: "민지 운동화", slot: "shoes" },
    ]);

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(Object.values(result.outfit).map((c) => c.id).sort()).toEqual(mine.map((c) => c.id).sort());
  });

  test("a 원피스 with shoes is a complete outfit", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [dress, flats] = await addClothes(minji, [
      { name: "원피스", slot: "dress" },
      { name: "플랫슈즈", slot: "shoes" },
    ]);

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.outfit).toEqual({ dress, shoes: flats });
  });

  test("without shoes the 옷장 cannot make an outfit, and says shoes are missing", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    await addClothes(minji, [
      { name: "티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
    ]);

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null });

    expect(result).toMatchObject({ status: "unbuildable", missingSlots: ["shoes"] });
  });

  test("tops without bottoms or a 원피스 cannot make an outfit, and say bottoms are missing", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    await addClothes(minji, [
      { name: "티셔츠", slot: "top" },
      { name: "운동화", slot: "shoes" },
    ]);

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null });

    expect(result).toMatchObject({ status: "unbuildable", missingSlots: ["bottom"] });
  });
});

describe("색상 조합", () => {
  test("a neutral top is chosen over one whose color clashes with the bottoms", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, whiteTee] = await addClothes(minji, [
      { name: "빨간 티셔츠", slot: "top", color: "red" },
      { name: "흰 티셔츠", slot: "top", color: "white" },
      { name: "초록 바지", slot: "bottom", color: "green" },
      { name: "검은 운동화", slot: "shoes", color: "black" },
    ]);

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null });

    expect(result).toMatchObject({ status: "ok", outfit: { top: whiteTee }, scores: { color: 1 } });
  });
});

describe("preferences", () => {
  test("a top in a preferred color is chosen over an otherwise equal top", async () => {
    const { recommender, wardrobe, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, navyTee] = await addClothes(minji, [
      { name: "회색 티셔츠", slot: "top", color: "gray" },
      { name: "남색 티셔츠", slot: "top", color: "navy" },
      { name: "청바지", slot: "bottom", color: "blue" },
      { name: "흰 운동화", slot: "shoes", color: "white" },
    ]);
    await wardrobe.setPreferences(minji, { colors: ["navy"], styles: [] });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null });

    expect(result).toMatchObject({ status: "ok", outfit: { top: navyTee } });
  });

  test("a top in a preferred style is chosen over an otherwise equal top", async () => {
    const { recommender, wardrobe, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, streetTee] = await addClothes(minji, [
      { name: "기본 티셔츠", slot: "top", style: "casual" },
      { name: "그래픽 티셔츠", slot: "top", style: "street" },
      { name: "청바지", slot: "bottom", style: "casual" },
      { name: "운동화", slot: "shoes", style: "casual" },
    ]);
    await wardrobe.setPreferences(minji, { colors: [], styles: ["street"] });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null });

    expect(result).toMatchObject({ status: "ok", outfit: { top: streetTee } });
  });
});

describe("recommending for a situation the user picked", () => {
  test("for a 면접 the outfit is made of formal clothes", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, shirt, , slacks, , loafers] = await addClothes(minji, [
      { name: "후드티", slot: "top", formality: "casual" },
      { name: "흰 셔츠", slot: "top", formality: "formal" },
      { name: "조거팬츠", slot: "bottom", formality: "casual" },
      { name: "정장 바지", slot: "bottom", formality: "formal" },
      { name: "운동화", slot: "shoes", formality: "casual" },
      { name: "구두", slot: "shoes", formality: "formal" },
    ]);

    const result = await recommender.recommendForDate({
      userId: minji,
      date: DATE,
      situation: "interview",
    });

    expect(result).toMatchObject({
      status: "ok",
      basis: { kind: "interview", formality: "formal" },
      outfit: { top: shirt, bottom: slacks, shoes: loafers },
    });
  });

  test("for a 면접 a 옷장 with only casual shoes cannot make an outfit", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    await addClothes(minji, [
      { name: "흰 셔츠", slot: "top", formality: "formal" },
      { name: "정장 바지", slot: "bottom", formality: "formal" },
      { name: "운동화", slot: "shoes", formality: "casual" },
    ]);

    const result = await recommender.recommendForDate({
      userId: minji,
      date: DATE,
      situation: "interview",
    });

    expect(result).toMatchObject({ status: "unbuildable", missingSlots: ["shoes"] });
  });

  test("for a 면접 without formal shoes, semi-formal shoes stand in", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, , loafers] = await addClothes(minji, [
      { name: "흰 셔츠", slot: "top", formality: "formal" },
      { name: "정장 바지", slot: "bottom", formality: "formal" },
      { name: "로퍼", slot: "shoes", formality: "semi-formal" },
      { name: "운동화", slot: "shoes", formality: "casual" },
    ]);

    const result = await recommender.recommendForDate({
      userId: minji,
      date: DATE,
      situation: "interview",
    });

    expect(result).toMatchObject({ status: "ok", outfit: { shoes: loafers } });
  });

  test("with 일정 없음 there is no basis and no 일정 score", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    await addClothes(minji, [
      { name: "흰 티셔츠", slot: "top", color: "white" },
      { name: "청바지", slot: "bottom", color: "blue" },
      { name: "검은 운동화", slot: "shoes", color: "black" },
    ]);

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.basis).toBeNull();
    expect(result.scores).toEqual({ color: 1, style: 1, preference: 0 });
  });
});
