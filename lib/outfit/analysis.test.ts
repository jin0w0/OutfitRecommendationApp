import { describe, expect, test } from "vitest";
import { createTestOutfit } from "./testing/harness";

const TODAY = "2026-11-10";

// Days before TODAY, as YYYY-MM-DD.
function daysAgo(days: number) {
  const date = new Date(`${TODAY}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function minji() {
  const outfit = await createTestOutfit({ today: TODAY });
  const userId = await outfit.createUser("minji@gmail.com");
  // Worn together with the piece under test, so outfits have something to pair with.
  const [jeans, sneakers] = await outfit.addClothes(userId, [
    { name: "청바지", slot: "bottom", registeredOn: daysAgo(200) },
    { name: "운동화", slot: "shoes", registeredOn: daysAgo(200) },
  ]);
  const wear = (date: string, ...ids: string[]) =>
    outfit.recommender.accept({ userId, date, clothingIds: [...ids, jeans.id, sneakers.id] });
  const unworn = async () => (await outfit.analysis.analyze(userId)).map((u) => u.clothing.name);
  return { ...outfit, userId, wear, unworn };
}

describe("안 입는 옷", () => {
  test("a piece last worn 30 or more days ago is unworn; one worn 29 days ago is not", async () => {
    const { addClothes, userId, wear, unworn } = await minji();
    const [thirty, twentyNine] = await addClothes(userId, [
      { name: "30일 전 셔츠", slot: "top", registeredOn: daysAgo(200) },
      { name: "29일 전 셔츠", slot: "top", registeredOn: daysAgo(200) },
    ]);
    await wear(daysAgo(30), thirty.id);
    await wear(daysAgo(29), twentyNine.id);

    expect(await unworn()).toContain("30일 전 셔츠");
    expect(await unworn()).not.toContain("29일 전 셔츠");
  });

  test("without a 착용 기록, the 추정 착용 빈도 decides", async () => {
    const { addClothes, userId, unworn } = await minji();
    await addClothes(userId, [
      { name: "매주 입는 티", slot: "top", estimatedWearFrequency: "weekly", registeredOn: daysAgo(100) },
      { name: "가끔 입는 티", slot: "top", estimatedWearFrequency: "monthly", registeredOn: daysAgo(100) },
      { name: "잘 안 입는 티", slot: "top", estimatedWearFrequency: "rarely", registeredOn: daysAgo(100) },
      { name: "새로 산 티", slot: "top", estimatedWearFrequency: "new", registeredOn: daysAgo(100) },
      { name: "빈도 모르는 티", slot: "top", registeredOn: daysAgo(100) },
    ]);

    const names = await unworn();

    expect(names).toEqual(expect.arrayContaining(["잘 안 입는 티", "새로 산 티", "빈도 모르는 티"]));
    expect(names).not.toContain("매주 입는 티");
    expect(names).not.toContain("가끔 입는 티");
  });

  test("a piece registered less than 14 days ago is 신규 등록, not diagnosed", async () => {
    const { analysis, addClothes, userId } = await minji();
    await addClothes(userId, [
      { name: "13일 된 티", slot: "top", estimatedWearFrequency: "new", registeredOn: daysAgo(13) },
      { name: "14일 된 티", slot: "top", estimatedWearFrequency: "new", registeredOn: daysAgo(14) },
    ]);

    const verdicts = Object.fromEntries((await analysis.analyze(userId)).map((u) => [u.clothing.name, u.verdict]));

    expect(verdicts["13일 된 티"]).toEqual({ kind: "new" });
    expect(verdicts["14일 된 티"]).not.toEqual({ kind: "new" });
  });

  test("정리한 옷 are left out", async () => {
    const { closet, addClothes, userId, unworn } = await minji();
    const [tidied] = await addClothes(userId, [{ name: "정리한 티", slot: "top", registeredOn: daysAgo(100) }]);

    await closet.tidy(userId, tidied.id);

    expect(await unworn()).not.toContain("정리한 티");
  });

  test("the longest unworn come first, never-worn pieces before any worn one", async () => {
    const { addClothes, userId, wear, unworn } = await minji();
    const [sixty, forty] = await addClothes(userId, [
      { name: "60일 전 셔츠", slot: "top", registeredOn: daysAgo(200) },
      { name: "40일 전 셔츠", slot: "top", registeredOn: daysAgo(200) },
      { name: "안 입은 셔츠", slot: "top", registeredOn: daysAgo(200) },
    ]);
    await wear(daysAgo(40), forty.id);
    await wear(daysAgo(60), sixty.id);

    expect((await unworn()).filter((name) => name.endsWith("셔츠"))).toEqual([
      "안 입은 셔츠",
      "60일 전 셔츠",
      "40일 전 셔츠",
    ]);
  });

  test("each unworn piece says when it was last worn", async () => {
    const { analysis, addClothes, userId, wear } = await minji();
    const [shirt] = await addClothes(userId, [{ name: "셔츠", slot: "top", registeredOn: daysAgo(200) }]);
    await wear(daysAgo(45), shirt.id);

    const found = (await analysis.analyze(userId)).find((u) => u.clothing.id === shirt.id);

    expect(found?.lastWornOn).toBe(daysAgo(45));
  });

  test("an older piece with nothing found in the data needs asking", async () => {
    const { analysis, addClothes, userId } = await minji();
    const [shirt] = await addClothes(userId, [{ name: "셔츠", slot: "top", registeredOn: daysAgo(100) }]);

    const found = (await analysis.analyze(userId)).find((u) => u.clothing.id === shirt.id);

    expect(found?.verdict).toEqual({ kind: "ask" });
  });
});
