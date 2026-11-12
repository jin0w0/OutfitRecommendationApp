import { describe, expect, test } from "vitest";
import { createTestOutfit, SEOUL } from "./testing/harness";

const DATE = "2026-11-10";

// 민지 with two tops, the first the one she is shown and will say she won't wear.
async function minjiWithTwoTops() {
  const outfit = await createTestOutfit({ today: DATE });
  const userId = await outfit.createUser("minji@gmail.com");
  const [shownTop, otherTop, pants, shoes] = await outfit.addClothes(userId, [
    { name: "보여 준 티", slot: "top", registeredOn: "2025-01-01" },
    { name: "다른 티", slot: "top", registeredOn: "2025-01-01" },
    { name: "바지", slot: "bottom", registeredOn: "2025-01-01" },
    { name: "신발", slot: "shoes", registeredOn: "2025-01-01" },
  ]);
  const outfitIds = [shownTop.id, pants.id, shoes.id];
  const dislike = (date = DATE) =>
    outfit.recommender.reject({ userId, date, clothingIds: outfitIds, reason: "dislike", dislikedClothingId: shownTop.id });
  const topOn = async (date: string) => {
    const result = await outfit.recommender.recommendForDate({ userId, date, situation: null, location: SEOUL });
    return result.status === "ok" ? result.outfit.top?.id : null;
  };
  return { ...outfit, userId, shownTop, otherTop, pants, shoes, dislike, topOn };
}

describe("입기 싫은 옷", () => {
  test("a piece the user won't wear is left out for 14 days, then comes back", async () => {
    const { setToday, dislike, topOn, shownTop, otherTop } = await minjiWithTwoTops();
    expect(await topOn(DATE)).toBe(shownTop.id);

    await dislike();
    expect(await topOn(DATE)).toBe(otherTop.id);

    setToday("2026-11-23");
    expect(await topOn("2026-11-23")).toBe(otherTop.id);
    setToday("2026-11-24");
    expect(await topOn("2026-11-24")).toBe(shownTop.id);
  });

  test("asking in the 대화 to keep it brings it back", async () => {
    const { recommender, llm, userId, dislike, shownTop } = await minjiWithTwoTops();
    await dislike();
    const first = await recommender.recommendForDate({ userId, date: DATE, situation: null, location: SEOUL });
    llm.interpret("그 티 입을래", [{ type: "keep", clothingId: shownTop.id }]);

    const revised = await recommender.revise({ userId, sessionId: first.sessionId, message: "그 티 입을래" });

    expect(revised).toMatchObject({ status: "ok", outfit: { top: { id: shownTop.id } } });
  });

  test("the piece must be one of the rejected 코디", async () => {
    const { recommender, userId, otherTop, pants, shoes } = await minjiWithTwoTops();

    await expect(
      recommender.reject({
        userId,
        date: DATE,
        clothingIds: [pants.id, shoes.id],
        reason: "dislike",
        dislikedClothingId: otherTop.id,
      }),
    ).rejects.toThrow();
  });

  test("going back to the start keeps the pieces the user won't wear", async () => {
    const { recommender, userId, dislike, topOn, otherTop } = await minjiWithTwoTops();
    await dislike();

    await recommender.resetTuning(userId);

    expect(await topOn(DATE)).toBe(otherTop.id);
  });
});

describe("입기 싫은 옷과 옷장 분석", () => {
  test("said twice within 30 days, the piece is taken as 마음 변화, before any data 원인", async () => {
    const { analysis, setToday, userId, dislike, shownTop } = await minjiWithTwoTops();
    await dislike("2026-11-01");
    expect((await analysis.analyze(userId)).find((u) => u.clothing.id === shownTop.id)?.verdict).not.toEqual({
      kind: "answered",
      answer: "changed-mind",
    });

    await dislike("2026-11-09");
    setToday("2026-11-10");

    const found = (await analysis.analyze(userId)).find((u) => u.clothing.id === shownTop.id);
    expect(found).toMatchObject({ verdict: { kind: "answered", answer: "changed-mind" }, remedies: ["tidy-suggestion"] });
  });

  test("two dislikes more than 30 days apart do not count", async () => {
    const { analysis, userId, dislike, shownTop } = await minjiWithTwoTops();
    await dislike("2026-09-01");
    await dislike("2026-11-09");

    const found = (await analysis.analyze(userId)).find((u) => u.clothing.id === shownTop.id);
    expect(found?.verdict).not.toEqual({ kind: "answered", answer: "changed-mind" });
  });
});
