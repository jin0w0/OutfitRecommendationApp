import { describe, expect, test } from "vitest";
import { createTestOutfit } from "./testing/harness";

// 민지 with a plain 셔츠 the data says nothing about, so she is asked about it.
async function minjiAskedAboutShirt() {
  const outfit = await createTestOutfit({ today: "2026-11-10" });
  const userId = await outfit.createUser("minji@gmail.com");
  const long = "2025-01-01";
  const [shirt, slacks, shoes] = await outfit.addClothes(userId, [
    { name: "셔츠", slot: "top", material: "linen", registeredOn: long },
    { name: "검정 슬랙스", slot: "bottom", registeredOn: long },
    { name: "흰 스니커즈", slot: "shoes", color: "white", registeredOn: long },
    { name: "검정 로퍼", slot: "shoes", registeredOn: long },
  ]);
  const shirtNow = async () => (await outfit.analysis.analyze(userId)).find((u) => u.clothing.id === shirt.id);
  return { ...outfit, userId, shirt, slacks, shoes, shirtNow };
}

describe("묻기와 답하기", () => {
  test("a piece the data says nothing about is asked about, with nothing offered yet", async () => {
    const { shirtNow } = await minjiAskedAboutShirt();

    expect(await shirtNow()).toMatchObject({ verdict: { kind: "ask" }, remedies: [] });
  });

  test("each answer becomes the 원인, with its own remedies, and is not asked again", async () => {
    for (const [answer, remedies] of [
      ["care", ["care-tips", "tidy-suggestion"]],
      ["changed-mind", ["tidy-suggestion"]],
      ["forgot", ["styling-outfits"]],
    ] as const) {
      const { analysis, userId, shirt, shirtNow } = await minjiAskedAboutShirt();

      await analysis.answer(userId, shirt.id, answer);

      expect(await shirtNow()).toMatchObject({ verdict: { kind: "answered", answer }, remedies });
    }
  });

  test("once the piece is worn again, the answer no longer holds", async () => {
    const { analysis, recommender, setToday, userId, shirt, slacks, shoes, shirtNow } = await minjiAskedAboutShirt();
    await analysis.answer(userId, shirt.id, "changed-mind");

    // Accepted on the day itself, so it is worn, not planned.
    setToday("2026-11-12");
    await recommender.accept({ userId, date: "2026-11-12", clothingIds: [shirt.id, slacks.id, shoes.id] });
    setToday("2026-12-20");

    expect(await shirtNow()).toMatchObject({ verdict: { kind: "ask" } });
  });

  test("only the owner can answer, and only with one of the three answers", async () => {
    const { analysis, createUser, userId, shirt } = await minjiAskedAboutShirt();
    const jun = await createUser("jun@gmail.com");

    await expect(analysis.answer(jun, shirt.id, "forgot")).rejects.toThrow();
    await expect(analysis.answer(userId, shirt.id, "bored" as never)).rejects.toThrow();
  });
});

describe("그대로 두기", () => {
  test("a piece kept as it is leaves the analysis for 90 days, then comes back", async () => {
    const { analysis, setToday, userId, shirt, shirtNow } = await minjiAskedAboutShirt();

    await analysis.keepAsIs(userId, shirt.id);
    setToday("2027-02-07");
    expect(await shirtNow()).toBeUndefined();

    setToday("2027-02-08");
    expect(await shirtNow()).toBeDefined();
  });

  test("only the owner can keep a piece as it is", async () => {
    const { analysis, createUser, shirt, shirtNow } = await minjiAskedAboutShirt();
    const jun = await createUser("jun@gmail.com");

    await expect(analysis.keepAsIs(jun, shirt.id)).rejects.toThrow();
    expect(await shirtNow()).toBeDefined();
  });
});

describe("답한 날 입은 경우", () => {
  test("a wear on the very day of the answer also undoes it", async () => {
    const { analysis, recommender, setToday, userId, shirt, slacks, shoes, shirtNow } = await minjiAskedAboutShirt();
    await analysis.answer(userId, shirt.id, "changed-mind");

    await recommender.accept({ userId, date: "2026-11-10", clothingIds: [shirt.id, slacks.id, shoes.id] });
    setToday("2026-12-20");

    expect(await shirtNow()).toMatchObject({ verdict: { kind: "ask" } });
  });
});
