import { describe, expect, test } from "vitest";
import { createTestOutfit, SEOUL } from "./testing/harness";

const DATE = "2026-11-10";
const ALL_ONE = { weather: 1, event: 1, color: 1, style: 1, preference: 1, recency: 1, utilization: 1 };

// 민지 with one plain outfit she likes by color but not by style, so 선호도
// half counts and ties 스타일 for the third 추천 이유.
async function minji() {
  const outfit = await createTestOutfit({ today: DATE });
  const userId = await outfit.createUser("minji@gmail.com");
  const clothes = await outfit.addClothes(userId, [
    { name: "검정 티", slot: "top" },
    { name: "검정 바지", slot: "bottom" },
    { name: "검정 신발", slot: "shoes" },
  ]);
  await outfit.closet.setPreferences(userId, { colors: ["black"], styles: ["street"] });
  const clothingIds = clothes.map((c) => c.id);
  const reject = (reason?: Parameters<typeof outfit.recommender.reject>[0]["reason"]) =>
    outfit.recommender.reject({ userId, date: DATE, clothingIds, reason });
  const multipliers = async () => (await outfit.recommender.tuning(userId)).multipliers;
  return { ...outfit, userId, reject, multipliers };
}

describe("추천 맞춤: 거절", () => {
  test("everyone starts from the same weights", async () => {
    const { multipliers } = await minji();

    expect(await multipliers()).toEqual(ALL_ONE);
  });

  test("each reason makes its own factor 1.1 times as important", async () => {
    for (const [reason, factor] of [
      ["color", "color"],
      ["taste", "preference"],
      ["weather", "weather"],
      ["event", "event"],
    ] as const) {
      const { reject, multipliers } = await minji();

      await reject(reason);

      expect(await multipliers()).toEqual({ ...ALL_ONE, [factor]: 1.1 });
    }
  });

  test("rejecting with no reason, or just to see another, changes nothing", async () => {
    const { reject, multipliers } = await minji();

    await reject();
    await reject("other");

    expect(await multipliers()).toEqual(ALL_ONE);
  });

  test("a factor never weighs more than twice its default", async () => {
    const { reject, multipliers } = await minji();

    for (let i = 0; i < 10; i++) await reject("color");

    expect((await multipliers()).color).toBe(2);
  });

  test("going back to the start undoes every rejection so far, not later ones", async () => {
    const { recommender, userId, reject, multipliers } = await minji();
    await reject("color");
    await reject("weather");

    await recommender.resetTuning(userId);
    expect(await multipliers()).toEqual(ALL_ONE);

    await reject("color");
    expect(await multipliers()).toEqual({ ...ALL_ONE, color: 1.1 });
  });

  test("the user's weights decide the 추천 이유 too", async () => {
    const { recommender, userId, reject } = await minji();
    const reasonFactors = async () => {
      const result = await recommender.recommendForDate({ userId, date: DATE, situation: null, location: SEOUL });
      return result.status === "ok" ? result.reasons.map((r) => r.evidence.factor) : [];
    };
    expect(await reasonFactors()).not.toContain("preference");

    await reject("taste");

    expect(await reasonFactors()).toContain("preference");
  });

  test("only reasons from the list are taken", async () => {
    const { reject } = await minji();

    await expect(reject("too-expensive" as never)).rejects.toThrow();
  });
});

describe("추천 맞춤: 수락", () => {
  async function minjiShownAnOutfit() {
    const outfit = await minji();
    const shown = await outfit.recommender.recommendForDate({
      userId: outfit.userId,
      date: DATE,
      situation: null,
      location: SEOUL,
    });
    if (shown.status !== "ok") throw new Error("expected a 코디");
    const clothingIds = Object.values(shown.outfit).map((c) => c.id);
    const reasonFactors = shown.reasons.map((r) => r.evidence.factor);
    const accept = (sessionId: string | undefined = shown.sessionId) =>
      outfit.recommender.accept({ userId: outfit.userId, date: DATE, clothingIds, sessionId });
    return { ...outfit, shown, reasonFactors, accept };
  }

  test("accepting a 코디 makes each factor of its 추천 이유 1.05 times as important", async () => {
    const { accept, reasonFactors, multipliers } = await minjiShownAnOutfit();

    await accept();

    const expected = { ...ALL_ONE };
    for (const factor of reasonFactors) expected[factor] = 1.05;
    expect(await multipliers()).toEqual(expected);
  });

  test("accepting the same date again counts once", async () => {
    const { accept, reasonFactors, multipliers } = await minjiShownAnOutfit();

    await accept();
    await accept();

    expect((await multipliers())[reasonFactors[0]]).toBe(1.05);
  });

  test("cancelling the acceptance takes it back", async () => {
    const { recommender, userId, accept, multipliers } = await minjiShownAnOutfit();
    await accept();

    await recommender.cancelAcceptance({ userId, date: DATE });

    expect(await multipliers()).toEqual(ALL_ONE);
  });

  test("an acceptance without its 추천 세션 changes nothing", async () => {
    const { recommender, userId, shown, multipliers } = await minjiShownAnOutfit();
    if (shown.status !== "ok") return;

    await recommender.accept({ userId, date: DATE, clothingIds: Object.values(shown.outfit).map((c) => c.id) });

    expect(await multipliers()).toEqual(ALL_ONE);
  });
});
