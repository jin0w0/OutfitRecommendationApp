import { describe, expect, test } from "vitest";
import { SEOUL, createTestOutfit } from "./testing/harness";
import { suggestionId } from "./one-more-piece";
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
const WHITE_SNEAKERS = piece({ name: "흰 스니커즈", slot: "shoes", color: "white" });
const GRAY_COAT = piece({ name: "회색 코트", slot: "outer", color: "gray" });

// 민지 and the 체크 셔츠 she does not wear.
async function minji() {
  const outfit = await createTestOutfit({ today: DATE });
  const userId = await outfit.createUser("minji@gmail.com");
  const [shirt] = await outfit.addClothes(userId, [
    { name: "체크 셔츠", slot: "top", color: "red" },
    { name: "흰 티", slot: "top", color: "white" },
    { name: "검정 바지", slot: "bottom", color: "black" },
    { name: "검정 신발", slot: "shoes", color: "black" },
  ]);
  const styling = () =>
    outfit.recommender.stylingPurchaseOutfits({ userId, clothingId: shirt.id, date: DATE, location: SEOUL });
  return { ...outfit, userId, shirt, styling };
}

describe("한 벌만 더하면: 안 입는 옷에 새 옷 한 벌", () => {
  test("every 코디 has the piece and exactly one new piece", async () => {
    const { pieceAdviser, shirt, styling } = await minji();
    pieceAdviser.willPropose([BEIGE_PANTS, WHITE_SNEAKERS, GRAY_COAT]);

    const outfits = await styling();

    expect(outfits?.length).toBeGreaterThan(0);
    expect(outfits!.length).toBeLessThanOrEqual(3);
    for (const { outfit, added } of outfits!) {
      expect(outfit.top).toEqual(shirt);
      expect(added).toHaveLength(1);
      expect(added[0].kind).toBe("new");
    }
    expect(pieceAdviser.targets[0]).toEqual({ revive: expect.objectContaining({ name: "체크 셔츠" }) });
  });

  test("a candidate dismissed with 관심 없어요 is left out", async () => {
    const { pieceAdviser, pieces, userId, shirt, styling } = await minji();
    pieceAdviser.willPropose([BEIGE_PANTS, WHITE_SNEAKERS]);
    await pieces.dismiss(userId, suggestionId(shirt.id, BEIGE_PANTS));

    const outfits = await styling();

    expect(outfits!.flatMap((o) => o.added.map((a) => a.clothing.name))).toEqual([WHITE_SNEAKERS.name]);
  });

  test("the same 옷장 again does not ask the LLM again", async () => {
    const { pieceAdviser, styling } = await minji();
    pieceAdviser.willPropose([BEIGE_PANTS]);

    await styling();
    await styling();

    expect(pieceAdviser.calls).toBe(1);
  });

  test("when the LLM fails there are none", async () => {
    const { pieceAdviser, styling } = await minji();
    pieceAdviser.failWith();

    expect(await styling()).toBeNull();
  });
});

describe("구매 추천에서 더 보기: 고정한 옷", () => {
  test("every 구매 추천 코디 has the piece, also after 구매 대화", async () => {
    const { pieceAdviser, recommender, llm, userId, shirt } = await minji();
    pieceAdviser.willPropose([BEIGE_PANTS, WHITE_SNEAKERS]);

    const first = await recommender.purchaseOutfits({
      userId,
      date: DATE,
      situation: null,
      location: SEOUL,
      fixedClothingId: shirt.id,
    });

    if (first.kind === "unavailable") throw new Error("expected 구매 추천 코디");
    expect(first.outfits.length).toBeGreaterThan(0);
    for (const { outfit } of first.outfits) expect(outfit.top).toEqual(shirt);

    llm.interpretPurchaseMessage("더 밝은 색으로", [{ type: "color", direction: "lighter" }]);
    const revised = await recommender.revisePurchase({ userId, sessionId: first.sessionId, message: "더 밝은 색으로" });

    if (revised.kind === "unavailable") throw new Error("expected 구매 추천 코디");
    expect(revised.outfits.length).toBeGreaterThan(0);
    for (const { outfit } of revised.outfits) expect(outfit.top).toEqual(shirt);
    expect(revised.conversation?.conditions).toContainEqual({ type: "keep", clothing: shirt, isNew: false });
  });
});
