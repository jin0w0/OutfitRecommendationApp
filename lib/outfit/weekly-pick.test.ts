import { describe, expect, test } from "vitest";
import { createTestOutfit } from "./testing/harness";

// 2026-11-09 is a Monday.
const MONDAY = "2026-11-09";

// 민지 with three plain tops she never wore, registered in that order, so the
// first-registered counts as the longest unworn.
async function minjiWithUnwornTops(today = MONDAY) {
  const outfit = await createTestOutfit({ today });
  const userId = await outfit.createUser("minji@gmail.com");
  const [first, second, third, slacks, shoes] = await outfit.addClothes(userId, [
    { name: "첫째 셔츠", slot: "top", registeredOn: "2025-01-01" },
    { name: "둘째 셔츠", slot: "top", registeredOn: "2025-02-01" },
    { name: "셋째 셔츠", slot: "top", registeredOn: "2025-03-01" },
    { name: "슬랙스", slot: "bottom", registeredOn: "2025-01-01", estimatedWearFrequency: "weekly" },
    { name: "구두", slot: "shoes", registeredOn: "2025-01-01", estimatedWearFrequency: "weekly" },
  ]);
  const pickName = async () => (await outfit.analysis.weeklyPick(userId))?.clothing.name ?? null;
  return { ...outfit, userId, first, second, third, slacks, shoes, pickName };
}

describe("이번 주에 꺼내 볼 옷", () => {
  test("the longest unworn piece is picked and stays the same all week", async () => {
    const { setToday, pickName } = await minjiWithUnwornTops();

    expect(await pickName()).toBe("첫째 셔츠");
    setToday("2026-11-15");
    expect(await pickName()).toBe("첫째 셔츠");
  });

  test("showing another goes through the ones not shown this week, then back to the start", async () => {
    const { analysis, userId, pickName } = await minjiWithUnwornTops();
    await pickName();

    expect((await analysis.showAnotherPick(userId))?.clothing.name).toBe("둘째 셔츠");
    expect((await analysis.showAnotherPick(userId))?.clothing.name).toBe("셋째 셔츠");
    expect((await analysis.showAnotherPick(userId))?.clothing.name).toBe("첫째 셔츠");
    expect(await pickName()).toBe("첫째 셔츠");
  });

  test("a new week picks afresh", async () => {
    const { analysis, setToday, userId, pickName } = await minjiWithUnwornTops();
    await pickName();
    await analysis.showAnotherPick(userId);

    setToday("2026-11-16");

    expect(await pickName()).toBe("첫째 셔츠");
  });

  test("once the piece is worn, another is picked", async () => {
    const { recommender, setToday, userId, first, slacks, shoes, pickName } = await minjiWithUnwornTops();
    await pickName();

    setToday("2026-11-10");
    await recommender.accept({ userId, date: "2026-11-10", clothingIds: [first.id, slacks.id, shoes.id] });
    setToday("2026-11-11");

    expect(await pickName()).toBe("둘째 셔츠");
  });

  test("a piece back in season is picked first; one out of season never", async () => {
    const outfit = await createTestOutfit({ today: "2026-09-07" });
    const userId = await outfit.createUser("minji@gmail.com");
    await outfit.addClothes(userId, [
      { name: "여름 린넨", slot: "top", seasons: ["summer"], registeredOn: "2025-01-01" },
      { name: "사계절 셔츠", slot: "top", registeredOn: "2025-01-02" },
      { name: "가을 니트", slot: "top", seasons: ["autumn", "winter"], registeredOn: "2025-06-01" },
      { name: "슬랙스", slot: "bottom", registeredOn: "2025-01-01", estimatedWearFrequency: "weekly" },
      { name: "구두", slot: "shoes", registeredOn: "2025-01-01", estimatedWearFrequency: "weekly" },
    ]);

    expect((await outfit.analysis.weeklyPick(userId))?.clothing.name).toBe("가을 니트");
  });

  test("with no 안 입는 옷, there is no pick", async () => {
    const outfit = await createTestOutfit({ today: MONDAY });
    const userId = await outfit.createUser("minji@gmail.com");
    await outfit.addClothes(userId, [{ name: "매일 셔츠", slot: "top", estimatedWearFrequency: "weekly" }]);

    expect(await outfit.analysis.weeklyPick(userId)).toBeNull();
  });

  test("whether another piece could be shown instead is told", async () => {
    const { analysis, userId } = await minjiWithUnwornTops();
    expect(await analysis.weeklyPick(userId)).toMatchObject({ hasOthers: true });

    const outfit = await createTestOutfit({ today: MONDAY });
    const solo = await outfit.createUser("solo@gmail.com");
    await outfit.addClothes(solo, [
      { name: "하나뿐인 셔츠", slot: "top", registeredOn: "2025-01-01" },
      { name: "슬랙스", slot: "bottom", registeredOn: "2025-01-01", estimatedWearFrequency: "weekly" },
      { name: "구두", slot: "shoes", registeredOn: "2025-01-01", estimatedWearFrequency: "weekly" },
    ]);
    expect(await outfit.analysis.weeklyPick(solo)).toMatchObject({ hasOthers: false });
  });
});
