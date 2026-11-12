import { describe, expect, test } from "vitest";
import { createTestOutfit, SEOUL } from "./testing/harness";

const DATE = "2026-11-10";

// 민지 with a piece she rarely wears and enough around it for several 코디.
async function minjiWithKnit() {
  const outfit = await createTestOutfit({ today: DATE });
  const minji = await outfit.createUser("minji@gmail.com");
  const [knit, tee, jeans, slacks, sneakers, loafers] = await outfit.addClothes(minji, [
    { name: "네이비 니트", slot: "top", color: "navy", formality: "semi-formal" },
    { name: "흰 티", slot: "top", color: "white" },
    { name: "청바지", slot: "bottom", color: "blue" },
    { name: "회색 슬랙스", slot: "bottom", color: "gray", formality: "semi-formal" },
    { name: "운동화", slot: "shoes", color: "white" },
    { name: "로퍼", slot: "shoes", color: "black", formality: "semi-formal" },
  ]);
  return { ...outfit, minji, knit, tee, jeans, slacks, sneakers, loafers };
}

const ids = (outfit: Record<string, { id: string }>) =>
  Object.values(outfit)
    .map((c) => c.id)
    .sort()
    .join();

describe("활용 코디", () => {
  test("every 활용 코디 has the piece, none repeats, and there are at most 3", async () => {
    const { recommender, minji, knit } = await minjiWithKnit();

    const outfits = await recommender.stylingOutfits({ userId: minji, clothingId: knit.id, date: DATE, location: SEOUL });

    expect(outfits.length).toBeGreaterThan(0);
    expect(outfits.length).toBeLessThanOrEqual(3);
    for (const outfit of outfits) expect(Object.values(outfit).map((c) => c.id)).toContain(knit.id);
    expect(new Set(outfits.map(ids)).size).toBe(outfits.length);
  });

  test("given a 격식 수준, the 활용 코디 are made at it", async () => {
    const { recommender, minji, knit } = await minjiWithKnit();

    const outfits = await recommender.stylingOutfits({
      userId: minji,
      clothingId: knit.id,
      date: DATE,
      location: SEOUL,
      formality: "semi-formal",
    });

    expect(outfits.length).toBeGreaterThan(0);
    for (const outfit of outfits) {
      expect(Object.values(outfit).every((c) => c.formality === "semi-formal")).toBe(true);
    }
  });

  test("when no 코디 can be made with the piece, there are none", async () => {
    const outfit = await createTestOutfit({ today: DATE });
    const minji = await outfit.createUser("minji@gmail.com");
    const [lonelyTop] = await outfit.addClothes(minji, [
      { name: "셔츠", slot: "top" },
      { name: "바지", slot: "bottom" },
    ]);

    expect(
      await outfit.recommender.stylingOutfits({ userId: minji, clothingId: lonelyTop.id, date: DATE, location: SEOUL }),
    ).toEqual([]);
  });
});

describe("고정 추천", () => {
  test("a recommendation with a piece fixed keeps it, also after a 대화 수정", async () => {
    const { recommender, llm, minji, knit, slacks } = await minjiWithKnit();

    const first = await recommender.recommendForDate({
      userId: minji,
      date: DATE,
      situation: null,
      location: SEOUL,
      fixedClothingId: knit.id,
    });
    expect(first).toMatchObject({ status: "ok", outfit: { top: { id: knit.id } } });

    llm.interpret("바지 바꿔줘", [{ type: "exclude", clothingId: slacks.id }]);
    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "바지 바꿔줘" });

    expect(revised).toMatchObject({ status: "ok", outfit: { top: { id: knit.id } } });
  });
});
