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
    // A second pair, so plain pieces make more than one well-matched 코디.
    { name: "로퍼", slot: "shoes", registeredOn: daysAgo(200) },
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

// An analysis on `today`, for 민지 with neutral basics registered long ago:
// two bottoms and two shoes, so plain pieces have well-matched 코디.
async function minjiOn(today: string) {
  const outfit = await createTestOutfit({ today });
  const userId = await outfit.createUser("minji@gmail.com");
  const long = "2025-01-01";
  await outfit.addClothes(userId, [
    { name: "검정 슬랙스", slot: "bottom", color: "black", registeredOn: long },
    { name: "회색 슬랙스", slot: "bottom", color: "gray", registeredOn: long },
    { name: "흰 스니커즈", slot: "shoes", color: "white", registeredOn: long },
    { name: "검정 로퍼", slot: "shoes", color: "black", registeredOn: long },
  ]);
  const verdictOf = async (clothingId: string) =>
    (await outfit.analysis.analyze(userId)).find((u) => u.clothing.id === clothingId);
  return { ...outfit, userId, verdictOf, long };
}

const SEOUL_AT = { latitude: 37.5665, longitude: 126.978 };

describe("원인: 계절 불일치", () => {
  test("a winter coat in summer is out of season until December, with no tidying suggested", async () => {
    const { addClothes, userId, verdictOf, long } = await minjiOn("2026-07-10");
    const [coat] = await addClothes(userId, [{ name: "울 코트", slot: "outer", seasons: ["winter"], registeredOn: long }]);

    const found = await verdictOf(coat.id);

    expect(found?.verdict).toEqual({ kind: "cause", cause: { type: "season", fromMonth: 12 } });
    expect(found?.remedies).toEqual(["season-reminder"]);
  });

  test("when its season begins, a piece that was out of season is back in season", async () => {
    const { addClothes, userId, verdictOf, long } = await minjiOn("2026-09-05");
    const [knit, linen] = await addClothes(userId, [
      { name: "가을 니트", slot: "top", seasons: ["autumn", "winter"], registeredOn: long },
      { name: "린넨 셔츠", slot: "top", seasons: ["summer", "autumn"], registeredOn: long },
    ]);

    expect((await verdictOf(knit.id))?.backInSeason).toBe(true);
    expect((await verdictOf(linen.id))?.backInSeason).toBe(false);
  });
});

describe("원인: 상황 불일치", () => {
  test("a formal piece when every recent 일정 was casual is out of place", async () => {
    const { recommender, addClothes, userId, verdictOf, long } = await minjiOn("2026-11-10");
    const [suitTop] = await addClothes(userId, [
      { name: "정장 셔츠", slot: "top", formality: "formal", registeredOn: long },
      { name: "후드티", slot: "top", formality: "casual", registeredOn: long },
    ]);
    for (const date of ["2026-10-20", "2026-11-01"]) {
      await recommender.recommendForDate({ userId, date, situation: "school", location: SEOUL_AT });
    }

    expect((await verdictOf(suitTop.id))?.verdict).toEqual({
      kind: "cause",
      cause: { type: "situation", formality: "formal", recentFormalities: ["casual"] },
    });
  });

  test("with no 일정 in the last 60 days, nothing is said about the situation", async () => {
    const { addClothes, userId, verdictOf, long } = await minjiOn("2026-11-10");
    const [suitTop] = await addClothes(userId, [{ name: "정장 셔츠", slot: "top", formality: "formal", registeredOn: long }]);

    expect((await verdictOf(suitTop.id))?.verdict).not.toMatchObject({ cause: { type: "situation" } });
  });

  test("out of season comes before out of place", async () => {
    const { recommender, addClothes, userId, verdictOf, long } = await minjiOn("2026-07-10");
    const [coat] = await addClothes(userId, [
      { name: "정장 코트", slot: "outer", formality: "formal", seasons: ["winter"], registeredOn: long },
    ]);
    await recommender.recommendForDate({ userId, date: "2026-07-01", situation: "school", location: SEOUL_AT });

    expect((await verdictOf(coat.id))?.verdict).toMatchObject({ cause: { type: "season" } });
  });
});

describe("원인: 대체재 중복", () => {
  test("a piece whose look-alike was worn in the last 30 days is a duplicate, with tidying suggested", async () => {
    const { recommender, addClothes, userId, verdictOf, long } = await minjiOn("2026-11-10");
    const [old, favourite, slacks, shoes] = await addClothes(userId, [
      { name: "오래된 네이비 니트", slot: "top", color: "navy", registeredOn: long },
      { name: "새 네이비 니트", slot: "top", color: "navy", registeredOn: long },
      { name: "슬랙스", slot: "bottom", registeredOn: long },
      { name: "구두", slot: "shoes", registeredOn: long },
    ]);
    await recommender.accept({ userId, date: "2026-11-03", clothingIds: [favourite.id, slacks.id, shoes.id] });

    const found = await verdictOf(old.id);

    expect(found?.verdict).toEqual({
      kind: "cause",
      cause: { type: "substitute", similar: { id: favourite.id, name: "새 네이비 니트" }, lastWornOn: "2026-11-03" },
    });
    expect(found?.remedies).toEqual(["styling-outfits", "tidy-suggestion"]);
  });

  test("a look-alike not worn for 30 days, or tidied away, does not count", async () => {
    const { recommender, closet, addClothes, userId, verdictOf, long } = await minjiOn("2026-11-10");
    const [a, b, c, slacks, shoes] = await addClothes(userId, [
      { name: "니트 A", slot: "top", color: "navy", registeredOn: long },
      { name: "니트 B", slot: "top", color: "navy", registeredOn: long },
      { name: "니트 C", slot: "top", color: "navy", registeredOn: long },
      { name: "슬랙스", slot: "bottom", registeredOn: long },
      { name: "구두", slot: "shoes", registeredOn: long },
    ]);
    await recommender.accept({ userId, date: "2026-09-01", clothingIds: [b.id, slacks.id, shoes.id] });
    await recommender.accept({ userId, date: "2026-11-05", clothingIds: [c.id, slacks.id, shoes.id] });
    await closet.tidy(userId, c.id);

    expect((await verdictOf(a.id))?.verdict).not.toMatchObject({ cause: { type: "substitute" } });
  });
});

describe("원인: 조합 부족과 취향 불일치", () => {
  // Only loud partners: the orange top matches well with one pairing at most.
  async function loudWardrobe() {
    const outfit = await createTestOutfit({ today: "2026-11-10" });
    const userId = await outfit.createUser("minji@gmail.com");
    const long = "2025-01-01";
    const [orangeTop] = await outfit.addClothes(userId, [
      { name: "주황 티", slot: "top", color: "orange", style: "street", registeredOn: long },
      { name: "초록 바지", slot: "bottom", color: "green", style: "classic", registeredOn: long },
      { name: "주황 바지", slot: "bottom", color: "orange", style: "street", registeredOn: long },
      { name: "보라 신발", slot: "shoes", color: "purple", style: "classic", registeredOn: long },
      { name: "검정 신발", slot: "shoes", color: "black", style: "street", registeredOn: long },
    ]);
    const found = async () => (await outfit.analysis.analyze(userId)).find((u) => u.clothing.id === orangeTop.id);
    return { ...outfit, userId, found };
  }

  test("a piece that makes fewer than 2 well-matched 코디 lacks combinations", async () => {
    const { found } = await loudWardrobe();

    expect((await found())?.verdict).toEqual({ kind: "cause", cause: { type: "combination", wellMatched: 1 } });
  });

  test("a piece far from what the user likes and usually wears is off their taste", async () => {
    const { recommender, closet, addClothes, userId, verdictOf, long } = await minjiOn("2026-11-10");
    const [pink, navyA, navyB, slacks, shoes] = await addClothes(userId, [
      { name: "분홍 스트릿 티", slot: "top", color: "pink", style: "street", registeredOn: long },
      { name: "네이비 셔츠", slot: "top", color: "navy", style: "classic", registeredOn: long },
      { name: "네이비 니트", slot: "top", color: "navy", style: "classic", registeredOn: long },
      { name: "회색 슬랙스 2", slot: "bottom", color: "gray", style: "classic", registeredOn: long },
      { name: "검정 구두", slot: "shoes", color: "black", style: "classic", registeredOn: long },
      // Street partners, so the pink top does make well-matched 코디.
      { name: "검정 조거", slot: "bottom", color: "black", style: "street", registeredOn: long },
      { name: "회색 조거", slot: "bottom", color: "gray", style: "street", registeredOn: long },
      { name: "검정 스트릿 스니커즈", slot: "shoes", color: "black", style: "street", registeredOn: long },
    ]);
    await closet.setPreferences(userId, { colors: ["navy"], styles: ["classic"] });
    for (const [date, top] of [["2026-10-20", navyA], ["2026-10-27", navyB]] as const) {
      await recommender.accept({ userId, date, clothingIds: [top.id, slacks.id, shoes.id] });
    }

    expect((await verdictOf(pink.id))?.verdict).toMatchObject({ kind: "cause", cause: { type: "taste" } });
  });

  test("lacking combinations comes before off taste", async () => {
    const { closet, userId, found } = await loudWardrobe();
    await closet.setPreferences(userId, { colors: ["navy"], styles: ["classic"] });

    expect((await found())?.verdict).toMatchObject({ cause: { type: "combination" } });
  });
});
