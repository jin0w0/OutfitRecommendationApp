import { describe, expect, test } from "vitest";
import { createTestOutfit, SEOUL } from "./testing/harness";

const TODAY = "2026-11-10";

async function minjiWithBasics() {
  const outfit = await createTestOutfit({ today: TODAY });
  const minji = await outfit.createUser("minji@gmail.com");
  const clothes = await outfit.addClothes(minji, [
    { name: "흰 티셔츠", slot: "top" },
    { name: "청바지", slot: "bottom" },
    { name: "운동화", slot: "shoes" },
  ]);
  return { ...outfit, minji, clothes };
}

describe("입을게요", () => {
  test("accepting today's outfit makes it a 착용 기록 for today", async () => {
    const { recommender, minji, clothes } = await minjiWithBasics();

    await recommender.accept({ userId: minji, date: TODAY, clothingIds: clothes.map((c) => c.id) });
    const result = await recommender.recommendForDate({ userId: minji, date: TODAY, situation: null, location: SEOUL });

    expect(result.accepted).toEqual({ status: "worn", clothes });
  });

  test("accepting a future date's outfit makes it a plan, not a 착용 기록", async () => {
    const { recommender, minji, clothes } = await minjiWithBasics();

    await recommender.accept({ userId: minji, date: "2026-11-14", clothingIds: clothes.map((c) => c.id) });
    const result = await recommender.recommendForDate({ userId: minji, date: "2026-11-14", situation: null, location: SEOUL });

    expect(result.accepted).toEqual({ status: "planned", clothes });
  });

  test("accepting a past date's outfit makes it a 착용 기록", async () => {
    const { recommender, minji, clothes } = await minjiWithBasics();

    await recommender.accept({ userId: minji, date: "2026-11-08", clothingIds: clothes.map((c) => c.id) });
    const result = await recommender.recommendForDate({ userId: minji, date: "2026-11-08", situation: null, location: SEOUL });

    expect(result.accepted).toMatchObject({ status: "worn" });
  });

  test("cancelling the acceptance removes the 착용 기록", async () => {
    const { recommender, minji, clothes } = await minjiWithBasics();
    await recommender.accept({ userId: minji, date: TODAY, clothingIds: clothes.map((c) => c.id) });

    await recommender.cancelAcceptance({ userId: minji, date: TODAY });
    const result = await recommender.recommendForDate({ userId: minji, date: TODAY, situation: null, location: SEOUL });

    expect(result.accepted).toBeNull();
  });

  test("cancelling the acceptance removes the plan", async () => {
    const { recommender, minji, clothes } = await minjiWithBasics();
    await recommender.accept({ userId: minji, date: "2026-11-14", clothingIds: clothes.map((c) => c.id) });

    await recommender.cancelAcceptance({ userId: minji, date: "2026-11-14" });
    const result = await recommender.recommendForDate({ userId: minji, date: "2026-11-14", situation: null, location: SEOUL });

    expect(result.accepted).toBeNull();
  });
});

describe("입을게요 with someone else's clothes", () => {
  test("is refused and records nothing", async () => {
    const { recommender, createUser, addClothes, minji, clothes } = await minjiWithBasics();
    const junho = await createUser("junho@gmail.com");
    const [junhoShirt] = await addClothes(junho, [{ name: "준호 셔츠", slot: "top" }]);

    await expect(
      recommender.accept({ userId: minji, date: TODAY, clothingIds: [junhoShirt.id, clothes[1].id, clothes[2].id] }),
    ).rejects.toThrow();
    const result = await recommender.recommendForDate({ userId: minji, date: TODAY, situation: null, location: SEOUL });

    expect(result.accepted).toBeNull();
  });
});

describe("최근 착용 기록과 활용도", () => {
  async function minjiWithTwoPants() {
    const outfit = await createTestOutfit({ today: TODAY });
    const minji = await outfit.createUser("minji@gmail.com");
    const [tee, jeans, chinos, sneakers] = await outfit.addClothes(minji, [
      { name: "흰 티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "면바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);
    const wear = (date: string, bottom: typeof jeans) =>
      outfit.recommender.accept({ userId: minji, date, clothingIds: [tee.id, bottom.id, sneakers.id] });
    return { ...outfit, minji, jeans, chinos, wear };
  }

  test("pants worn yesterday are passed over for pants not worn in a long time", async () => {
    const { recommender, minji, chinos, jeans, wear } = await minjiWithTwoPants();
    await wear("2026-11-09", jeans);

    const result = await recommender.recommendForDate({ userId: minji, date: TODAY, situation: null, location: SEOUL });

    expect(result).toMatchObject({ status: "ok", outfit: { bottom: chinos } });
  });

  test("of two pants not worn lately, the one worn longer ago is chosen", async () => {
    const { recommender, minji, jeans, chinos, wear } = await minjiWithTwoPants();
    await wear("2026-10-20", chinos);
    await wear("2026-10-30", jeans);

    const result = await recommender.recommendForDate({ userId: minji, date: TODAY, situation: null, location: SEOUL });

    expect(result).toMatchObject({ status: "ok", outfit: { bottom: chinos } });
  });

  test("a plan does not count as wearing the clothes", async () => {
    const { recommender, minji, jeans, chinos, wear } = await minjiWithTwoPants();
    await wear("2026-11-09", chinos);
    await wear("2026-11-11", jeans);

    const result = await recommender.recommendForDate({ userId: minji, date: "2026-11-12", situation: null, location: SEOUL });

    expect(result).toMatchObject({ status: "ok", outfit: { bottom: jeans } });
  });

  test("a cancelled 착용 기록 no longer counts", async () => {
    const { recommender, minji, jeans, chinos, wear } = await minjiWithTwoPants();
    await wear("2026-11-08", chinos);
    await wear("2026-11-09", jeans);
    await recommender.cancelAcceptance({ userId: minji, date: "2026-11-09" });

    const result = await recommender.recommendForDate({ userId: minji, date: TODAY, situation: null, location: SEOUL });

    expect(result).toMatchObject({ status: "ok", outfit: { bottom: jeans } });
  });
});

describe("다시 추천받기", () => {
  const ids = (outfit: object) => Object.values(outfit).map((c: { id: string }) => c.id);

  test("asking again for the same date gives an outfit different from the last one", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit({ today: TODAY });
    const minji = await createUser("minji@gmail.com");
    await addClothes(minji, [
      { name: "흰 티셔츠", slot: "top" },
      { name: "회색 티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);
    const first = await recommender.recommendForDate({ userId: minji, date: TODAY, situation: null, location: SEOUL });
    if (first.status !== "ok") throw new Error("expected an outfit");

    const again = await recommender.recommendForDate({
      userId: minji,
      date: TODAY,
      situation: null, location: SEOUL,
      shown: [ids(first.outfit)],
    });

    expect(again.status).toBe("ok");
    if (again.status !== "ok") return;
    expect(ids(again.outfit).sort()).not.toEqual(ids(first.outfit).sort());
  });

  test("asking a third time avoids both outfits already shown", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit({ today: TODAY });
    const minji = await createUser("minji@gmail.com");
    const [white, gray, black] = await addClothes(minji, [
      { name: "흰 티셔츠", slot: "top" },
      { name: "회색 티셔츠", slot: "top" },
      { name: "검은 티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);
    const first = await recommender.recommendForDate({ userId: minji, date: TODAY, situation: null, location: SEOUL });
    if (first.status !== "ok") throw new Error("expected an outfit");
    const second = await recommender.recommendForDate({
      userId: minji,
      date: TODAY,
      situation: null, location: SEOUL,
      shown: [ids(first.outfit)],
    });
    if (second.status !== "ok") throw new Error("expected an outfit");

    const third = await recommender.recommendForDate({
      userId: minji,
      date: TODAY,
      situation: null, location: SEOUL,
      shown: [ids(first.outfit), ids(second.outfit)],
    });

    expect(third.status).toBe("ok");
    if (third.status !== "ok") return;
    const tops = [first, second, third].map((r) => (r.status === "ok" ? r.outfit.top?.id : undefined));
    expect(tops.sort()).toEqual([white.id, gray.id, black.id].sort());
  });

  test("when the 옷장 makes only one outfit, asking again gives that outfit", async () => {
    const { recommender, minji, clothes } = await minjiWithBasics();

    const again = await recommender.recommendForDate({
      userId: minji,
      date: TODAY,
      situation: null, location: SEOUL,
      shown: [clothes.map((c) => c.id)],
    });

    expect(again).toMatchObject({ status: "ok", outfit: { top: clothes[0], bottom: clothes[1], shoes: clothes[2] } });
  });
});

describe("탈퇴", () => {
  test("after 탈퇴 none of the user's 착용 기록 or plans remain", async () => {
    const { recommender, minji, clothes, deleteAccount } = await minjiWithBasics();
    const clothingIds = clothes.map((c) => c.id);
    await recommender.accept({ userId: minji, date: "2026-11-09", clothingIds });
    await recommender.accept({ userId: minji, date: "2026-11-14", clothingIds });

    await deleteAccount(minji);

    for (const date of ["2026-11-09", "2026-11-14"]) {
      const result = await recommender.recommendForDate({ userId: minji, date, situation: null, location: SEOUL });
      expect(result.accepted).toBeNull();
    }
  });
});
