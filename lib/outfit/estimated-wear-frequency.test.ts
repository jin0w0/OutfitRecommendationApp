import { describe, expect, test } from "vitest";
import { createTestOutfit, SEOUL } from "./testing/harness";

const TODAY = "2026-11-10";

// 민지 with two tops alike in all but how often she said she wears them; the
// one she rarely wears is added last, so ties would go to the other.
async function minjiWithTwoTops() {
  const outfit = await createTestOutfit({ today: TODAY });
  const minji = await outfit.createUser("minji@gmail.com");
  const [weeklyTop, rarelyTop, jeans, sneakers] = await outfit.addClothes(minji, [
    { name: "자주 입는 티", slot: "top", estimatedWearFrequency: "weekly" },
    { name: "잘 안 입는 티", slot: "top", estimatedWearFrequency: "rarely" },
    { name: "청바지", slot: "bottom" },
    { name: "운동화", slot: "shoes" },
  ]);
  const recommend = () =>
    outfit.recommender.recommendForDate({ userId: minji, date: TODAY, situation: null, location: SEOUL });
  return { ...outfit, minji, weeklyTop, rarelyTop, jeans, sneakers, recommend };
}

describe("추정 착용 빈도", () => {
  test("a piece the user rarely wears is preferred over one they wear weekly", async () => {
    const { recommend, rarelyTop } = await minjiWithTwoTops();

    expect(await recommend()).toMatchObject({ outfit: { top: { id: rarelyTop.id } } });
  });

  test("once a piece has a 착용 기록, the estimate no longer counts", async () => {
    const { recommender, recommend, minji, weeklyTop, rarelyTop, jeans, sneakers } = await minjiWithTwoTops();

    await recommender.accept({ userId: minji, date: "2026-11-09", clothingIds: [rarelyTop.id, jeans.id, sneakers.id] });

    expect(await recommend()).toMatchObject({ outfit: { top: { id: weeklyTop.id } } });
  });

  test("추천 이유 drawn from an estimate say so, and claim no day count for that piece", async () => {
    const { llm, recommend, rarelyTop } = await minjiWithTwoTops();
    llm.failWith();

    const result = await recommend();

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const fromWear = result.reasons.filter((r) => r.evidence.factor === "recency" || r.evidence.factor === "utilization");
    expect(fromWear.length).toBeGreaterThan(0);
    for (const reason of fromWear) {
      expect(reason.evidence).toMatchObject({ facts: { estimated: [rarelyTop.id] } });
      const aboutTop = reason.sentence.split(". ").find((clause) => clause.includes("잘 안 입는 티"));
      expect(aboutTop).toBeDefined();
      expect(aboutTop).not.toMatch(/\d+일/);
    }
  });
});
