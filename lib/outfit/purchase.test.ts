import { describe, expect, test } from "vitest";
import { createTestOutfit, SEOUL } from "./testing/harness";
import type { ClothingFields } from "./wardrobe";

const DATE = "2026-11-10";

function piece(fields: Partial<ClothingFields> & Pick<ClothingFields, "name" | "slot" | "color">): ClothingFields {
  return {
    seasons: ["spring", "summer", "autumn", "winter"],
    style: "casual",
    formality: "casual",
    warmth: 2,
    material: "cotton",
    ...fields,
  };
}

const BEIGE_PANTS = piece({ name: "베이지 치노 팬츠", slot: "bottom", color: "beige" });
const NAVY_CARDIGAN = piece({ name: "네이비 카디건", slot: "top", color: "navy" });
const WHITE_SNEAKERS = piece({ name: "흰 스니커즈", slot: "shoes", color: "white" });

// 민지 with a plain casual 옷장 that makes a 코디 already.
async function minji() {
  const outfit = await createTestOutfit({ today: DATE });
  const userId = await outfit.createUser("minji@gmail.com");
  const owned = await outfit.addClothes(userId, [
    { name: "흰 티", slot: "top", color: "white" },
    { name: "검정 바지", slot: "bottom", color: "black" },
    { name: "검정 신발", slot: "shoes", color: "black" },
  ]);
  const shop = (situation: "work" | null = null) =>
    outfit.recommender.purchaseOutfits({ userId, date: DATE, situation, location: SEOUL });
  return { ...outfit, userId, owned, shop };
}

describe("구매 추천: 가진 옷 + 새 옷 1벌", () => {
  test("each 코디 has exactly one new piece, the rest owned, no new piece twice, at most 3", async () => {
    const { pieceAdviser, owned, shop } = await minji();
    pieceAdviser.willPropose([BEIGE_PANTS, { ...BEIGE_PANTS, name: "베이지 슬랙스" }, NAVY_CARDIGAN, WHITE_SNEAKERS, piece({ name: "회색 후드", slot: "top", color: "gray" })]);

    const result = await shop();

    expect(result.kind).toBe("with-wardrobe");
    if (result.kind !== "with-wardrobe") return;
    expect(result.outfits.length).toBeGreaterThan(0);
    expect(result.outfits.length).toBeLessThanOrEqual(3);
    const ownedIds = new Set(owned.map((c) => c.id));
    const newLooks = new Set<string>();
    for (const { outfit, added } of result.outfits) {
      const pieces = Object.values(outfit);
      const newOnes = pieces.filter((c) => !ownedIds.has(c.id));
      expect(newOnes).toHaveLength(1);
      expect(added.kind).toBe("new");
      if (added.kind === "new") newLooks.add(`${added.piece.slot}|${added.piece.color}`);
    }
    expect(newLooks.size).toBe(result.outfits.length);
  });

  test("each new piece says how many owned pieces it newly goes with", async () => {
    const { pieceAdviser, shop } = await minji();
    pieceAdviser.willPropose([BEIGE_PANTS]);

    const result = await shop();

    expect(result).toMatchObject({ kind: "with-wardrobe", outfits: [{ matchesOwned: 2 }] });
  });

  test("a piece like one already owned is not suggested", async () => {
    const { pieceAdviser, shop } = await minji();
    pieceAdviser.willPropose([piece({ name: "또 검정 바지", slot: "bottom", color: "black" }), BEIGE_PANTS]);

    const result = await shop();

    expect(result.kind === "with-wardrobe" && result.outfits.map((o) => o.added.kind === "new" && o.added.piece.name)).toEqual([
      "베이지 치노 팬츠",
    ]);
  });

  test("the day's 격식 수준 is kept", async () => {
    const { pieceAdviser, addClothes, userId, shop } = await minji();
    await addClothes(userId, [
      { name: "셔츠", slot: "top", color: "white", formality: "semi-formal" },
      { name: "로퍼", slot: "shoes", color: "black", formality: "semi-formal" },
    ]);
    const greySlacks = piece({ name: "회색 슬랙스", slot: "bottom", color: "gray", formality: "semi-formal" });
    pieceAdviser.willPropose([BEIGE_PANTS, greySlacks]);

    const result = await shop("work");

    expect(result.kind).toBe("with-wardrobe");
    if (result.kind !== "with-wardrobe") return;
    for (const { outfit } of result.outfits) {
      expect(Object.values(outfit).every((c) => c.formality === "semi-formal")).toBe(true);
    }
  });

  test("when the LLM fails, there is no 구매 추천", async () => {
    const { pieceAdviser, shop } = await minji();
    pieceAdviser.failWith();

    expect(await shop()).toEqual({ kind: "unavailable" });
  });

  test("the same day again does not ask the LLM again", async () => {
    const { pieceAdviser, shop } = await minji();
    pieceAdviser.willPropose([BEIGE_PANTS]);

    await shop();
    await shop();

    expect(pieceAdviser.calls).toBe(1);
  });
});

describe("구매 추천: 옷장이 모자랄 때", () => {
  test("with no 코디 from the 옷장, whole new 코디 are shown, only well-formed ones", async () => {
    const outfit = await createTestOutfit({ today: DATE });
    const userId = await outfit.createUser("minji@gmail.com");
    await outfit.addClothes(userId, [{ name: "흰 티", slot: "top", color: "white" }]);
    const good = { pieces: [NAVY_CARDIGAN, BEIGE_PANTS, WHITE_SNEAKERS] };
    const noShoes = { pieces: [NAVY_CARDIGAN, BEIGE_PANTS] };
    const badColor = { pieces: [NAVY_CARDIGAN, { ...BEIGE_PANTS, color: "teal" }, WHITE_SNEAKERS] };
    outfit.pieceAdviser.willProposeOutfits([noShoes, good, badColor]);

    const result = await outfit.recommender.purchaseOutfits({ userId, date: DATE, situation: null, location: SEOUL });

    expect(result).toEqual({
      kind: "all-new",
      outfits: [{ top: NAVY_CARDIGAN, bottom: BEIGE_PANTS, shoes: WHITE_SNEAKERS }],
    });
  });
});
