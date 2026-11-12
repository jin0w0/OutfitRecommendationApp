import { describe, expect, test } from "vitest";
import { SEOUL, createTestOutfit } from "./testing/harness";
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

const BEIGE_DRESS = piece({ name: "베이지 코튼 원피스", slot: "dress", color: "beige" });
const BEIGE_PANTS = piece({ name: "베이지 치노 팬츠", slot: "bottom", color: "beige" });
const NAVY_CARDIGAN = piece({ name: "네이비 카디건", slot: "top", color: "navy" });
const WHITE_SNEAKERS = piece({ name: "흰 스니커즈", slot: "shoes", color: "white" });

async function jihoon() {
  const outfit = await createTestOutfit({ today: DATE });
  const userId = await outfit.createUser("jihoon@gmail.com");
  const owned = await outfit.addClothes(userId, [
    { name: "체크 셔츠", slot: "top", color: "red" },
    { name: "검정 바지", slot: "bottom", color: "black" },
    { name: "검정 신발", slot: "shoes", color: "black" },
  ]);
  const shop = () => outfit.recommender.purchaseOutfits({ userId, date: DATE, situation: null, location: SEOUL });
  return { ...outfit, userId, owned, shop };
}

const addedSlots = (result: Awaited<ReturnType<Awaited<ReturnType<typeof jihoon>>["shop"]>>) =>
  result.kind === "unavailable" ? [] : result.outfits.flatMap((o) => o.added.map((a) => a.clothing.slot));

describe("추천받을 옷 구분 저장", () => {
  test("none until chosen, then what was chosen", async () => {
    const { closet, userId } = await jihoon();

    expect(await closet.clothingLine(userId)).toBeNull();
    await closet.setClothingLine(userId, "menswear");

    expect(await closet.clothingLine(userId)).toBe("menswear");
    expect(await closet.preferences(userId)).toEqual({ colors: [], styles: [] });
  });

  test("choosing it keeps the 선호 색상·스타일, and saving those keeps it", async () => {
    const { closet, userId } = await jihoon();
    await closet.setPreferences(userId, { colors: ["navy"], styles: ["casual"] });
    await closet.setClothingLine(userId, "womenswear");
    await closet.setPreferences(userId, { colors: ["black"], styles: [] });

    expect(await closet.preferences(userId)).toEqual({ colors: ["black"], styles: [] });
    expect(await closet.clothingLine(userId)).toBe("womenswear");
  });

  test("a value outside the list is refused", async () => {
    const { closet, userId } = await jihoon();

    await expect(closet.setClothingLine(userId, "kidswear" as never)).rejects.toThrow();
  });
});

describe("남성복: no 원피스 among new pieces", () => {
  test("구매 추천 leaves out a new 원피스, and the LLM is told", async () => {
    const { closet, pieceAdviser, userId, shop } = await jihoon();
    await closet.setClothingLine(userId, "menswear");
    pieceAdviser.willPropose([BEIGE_DRESS, BEIGE_PANTS]);

    const result = await shop();

    expect(addedSlots(result)).not.toContain("dress");
    expect(addedSlots(result).length).toBeGreaterThan(0);
    expect(pieceAdviser.preferencesSeen.at(-1)).toMatchObject({ line: "menswear" });
  });

  test("without a choice a new 원피스 may be suggested", async () => {
    const { pieceAdviser, shop } = await jihoon();
    pieceAdviser.willPropose([BEIGE_DRESS]);

    expect(addedSlots(await shop())).toEqual(["dress"]);
  });

  test("whole new 코디 with a 원피스 are left out", async () => {
    const outfit = await createTestOutfit({ today: DATE });
    const userId = await outfit.createUser("jihoon@gmail.com");
    await outfit.closet.setClothingLine(userId, "menswear");
    outfit.pieceAdviser.willProposeOutfits([
      { pieces: [BEIGE_DRESS, WHITE_SNEAKERS] },
      { pieces: [NAVY_CARDIGAN, BEIGE_PANTS, WHITE_SNEAKERS] },
    ]);

    const result = await outfit.recommender.purchaseOutfits({ userId, date: DATE, situation: null, location: SEOUL });

    expect(result.kind).toBe("all-new");
    if (result.kind !== "all-new") return;
    expect(result.outfits).toHaveLength(1);
    expect(result.outfits[0].outfit.dress).toBeUndefined();
  });

  test("\"원피스로\" in 구매 대화 finds none", async () => {
    const { closet, pieceAdviser, llm, recommender, userId, shop } = await jihoon();
    await closet.setClothingLine(userId, "menswear");
    pieceAdviser.willPropose([BEIGE_PANTS]);
    pieceAdviser.willProposeForRequest([BEIGE_DRESS]);
    const first = await shop();
    llm.interpretPurchaseMessage("원피스로", [{ type: "slots", slots: ["dress"] }]);

    const result = await recommender.revisePurchase({ userId, sessionId: first.sessionId, message: "원피스로" });

    expect(result.unapplied).toMatchObject({ reason: "unbuildable" });
  });

  test("한 벌만 더하면 and 이 한 벌 제안 leave out a 원피스", async () => {
    const { closet, pieceAdviser, pieces, recommender, userId, owned } = await jihoon();
    await closet.setClothingLine(userId, "menswear");
    pieceAdviser.willPropose([BEIGE_DRESS, BEIGE_PANTS, WHITE_SNEAKERS]);
    const shirt = owned[0];

    const styled = await recommender.stylingPurchaseOutfits({ userId, clothingId: shirt.id, date: DATE, location: SEOUL });
    const suggested = await pieces.reviving(userId, shirt.id);

    expect(styled!.flatMap((o) => o.added.map((a) => a.clothing.slot))).not.toContain("dress");
    expect(suggested.map((s) => (s.kind === "new" ? s.piece.slot : s.clothing.slot))).not.toContain("dress");
  });
});
