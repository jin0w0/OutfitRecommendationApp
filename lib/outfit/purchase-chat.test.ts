import { describe, expect, test } from "vitest";
import { FAKE_SENTENCE, SEOUL, createTestOutfit } from "./testing/harness";
import { hasColorDirection } from "./revision";
import type { PurchaseRecommendation } from "./recommender";
import type { AskedPurchaseCondition } from "./purchase";
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
const BROWN_CARDIGAN = piece({ name: "갈색 카디건", slot: "top", color: "brown" });
const WHITE_SNEAKERS = piece({ name: "흰 스니커즈", slot: "shoes", color: "white" });
const GRAY_COAT = piece({ name: "회색 코트", slot: "outer", color: "gray" });
const BEIGE_JACKET = piece({ name: "베이지 재킷", slot: "outer", color: "beige" });

// 민지 with a plain casual 옷장 that makes a 코디, looking at 구매 추천.
async function shopping() {
  const outfit = await createTestOutfit({ today: DATE });
  const userId = await outfit.createUser("minji@gmail.com");
  const owned = await outfit.addClothes(userId, [
    { name: "흰 티", slot: "top", color: "white" },
    { name: "네이비 셔츠", slot: "top", color: "navy" },
    { name: "검정 바지", slot: "bottom", color: "black" },
    { name: "검정 신발", slot: "shoes", color: "black" },
  ]);
  outfit.pieceAdviser.willPropose([BEIGE_PANTS, BROWN_CARDIGAN, WHITE_SNEAKERS]);
  const first = await outfit.recommender.purchaseOutfits({ userId, date: DATE, situation: null, location: SEOUL });
  const say = (message: string) => outfit.recommender.revisePurchase({ userId, sessionId: first.sessionId, message });
  return { ...outfit, userId, owned, first, say };
}

function outfitsOf(result: PurchaseRecommendation) {
  if (result.kind === "unavailable") throw new Error("expected 구매 추천 코디");
  return result.outfits;
}

const addedOf = (result: PurchaseRecommendation) => outfitsOf(result).map((o) => o.added.map((a) => a.clothing));

describe("구매 대화: 구매 조건", () => {
  test("\"아우터로\" adds a new 아우터 only, asking the LLM for one when there is none yet", async () => {
    const { llm, pieceAdviser, say } = await shopping();
    pieceAdviser.willProposeForRequest([GRAY_COAT, BEIGE_JACKET]);
    llm.interpretPurchaseMessage("아우터로 추천해 줘", [{ type: "slots", slots: ["outer"] }]);

    const result = await say("아우터로 추천해 줘");

    expect(result.unapplied).toBeNull();
    const added = addedOf(result);
    expect(added.length).toBeGreaterThan(0);
    for (const pieces of added) expect(pieces.map((p) => p.slot)).toEqual(["outer"]);
    expect(pieceAdviser.targets.at(-1)).toMatchObject({ request: { slots: ["outer"] } });
  });

  test("\"더 밝은 색으로\" adds one light new piece each", async () => {
    const { llm, pieceAdviser, say } = await shopping();
    pieceAdviser.willProposeForRequest([piece({ name: "분홍 니트", slot: "top", color: "pink" })]);
    llm.interpretPurchaseMessage("더 밝은 색으로", [{ type: "color", direction: "lighter" }]);

    const added = addedOf(await say("더 밝은 색으로"));

    expect(added.length).toBeGreaterThan(0);
    for (const pieces of added) {
      expect(pieces).toHaveLength(1);
      expect(hasColorDirection(pieces[0].color, "lighter")).toBe(true);
    }
  });

  test("a 소재 and a named color are kept by every new piece", async () => {
    const { llm, pieceAdviser, say } = await shopping();
    const grayKnit = piece({ name: "회색 니트", slot: "top", color: "gray", material: "knit" });
    pieceAdviser.willProposeForRequest([grayKnit, piece({ name: "베이지 니트", slot: "top", color: "beige", material: "knit" })]);
    llm.interpretPurchaseMessage("회색 니트로", [
      { type: "material", material: "knit" },
      { type: "color-name", color: "gray" },
    ]);

    const added = addedOf(await say("회색 니트로"));

    expect(added).toEqual([[expect.objectContaining({ name: "회색 니트", material: "knit", color: "gray" })]]);
  });

  test("\"더 포멀하게\" adds pieces one 격식 수준 up", async () => {
    const { llm, pieceAdviser, say } = await shopping();
    pieceAdviser.willProposeForRequest([
      piece({ name: "회색 슬랙스", slot: "bottom", color: "gray", formality: "semi-formal" }),
      piece({ name: "갈색 로퍼", slot: "shoes", color: "brown", formality: "semi-formal" }),
    ]);
    llm.interpretPurchaseMessage("더 포멀하게", [{ type: "style", direction: "formal" }]);

    const added = addedOf(await say("더 포멀하게"));

    expect(added.length).toBeGreaterThan(0);
    for (const pieces of added) expect(pieces.every((p) => p.formality === "semi-formal")).toBe(true);
  });

  test("an owned piece asked to be kept is in every 코디", async () => {
    const { llm, owned, say } = await shopping();
    const navyShirt = owned[1];
    llm.interpretPurchaseMessage("내 네이비 셔츠랑 어울리게", [{ type: "keep", clothingId: navyShirt.id }]);

    const result = await say("내 네이비 셔츠랑 어울리게");

    expect(outfitsOf(result).length).toBeGreaterThan(0);
    for (const { outfit } of outfitsOf(result)) expect(outfit.top).toEqual(navyShirt);
  });

  test("\"이 바지 말고\" drops the new trousers shown", async () => {
    const { llm, say } = await shopping();
    llm.interpretPurchaseMessage("이 바지 말고", (request) => [
      { type: "exclude", clothingId: request.outfits.flat().find((c) => c.name === BEIGE_PANTS.name)!.id },
    ]);

    const result = await say("이 바지 말고");

    expect(result.unapplied).toBeNull();
    expect(addedOf(result).length).toBeGreaterThan(0);
    expect(addedOf(result).flat().map((p) => p.name)).not.toContain(BEIGE_PANTS.name);
  });

  test("a new piece asked to be kept stays, with owned clothes around it", async () => {
    const { llm, say } = await shopping();
    llm.interpretPurchaseMessage("이 카디건 좋아", (request) => [
      { type: "keep", clothingId: request.outfits.flat().find((c) => c.name === BROWN_CARDIGAN.name)!.id },
    ]);

    const added = addedOf(await say("이 카디건 좋아"));

    expect(added.length).toBeGreaterThan(0);
    for (const pieces of added) expect(pieces.map((p) => p.name)).toEqual([BROWN_CARDIGAN.name]);
  });
});

describe("구매 대화: 새 옷 여러 벌", () => {
  test("\"바지랑 신발 둘 다 새로\" adds new trousers and shoes, keeping an owned top", async () => {
    const { llm, owned, pieceAdviser, say } = await shopping();
    pieceAdviser.willProposeForRequest([
      piece({ name: "회색 조거", slot: "bottom", color: "gray" }),
      piece({ name: "회색 운동화", slot: "shoes", color: "gray" }),
    ]);
    llm.interpretPurchaseMessage("바지랑 신발 둘 다 새로", [{ type: "slots", slots: ["bottom", "shoes"] }]);

    const result = await say("바지랑 신발 둘 다 새로");

    const ownedIds = owned.map((c) => c.id);
    expect(outfitsOf(result).length).toBeGreaterThan(0);
    for (const { outfit, added } of outfitsOf(result)) {
      expect(added.map((a) => a.clothing.slot).sort()).toEqual(["bottom", "shoes"]);
      expect(ownedIds).toContain(outfit.top!.id);
    }
  });

  test("\"전부 새 옷으로\" makes every piece new", async () => {
    const { llm, say } = await shopping();
    llm.interpretPurchaseMessage("전부 새 옷으로", [{ type: "slots", slots: "all" }]);

    const result = await say("전부 새 옷으로");

    expect(result.kind).toBe("all-new");
    expect(outfitsOf(result).length).toBeGreaterThan(0);
    for (const { outfit, added } of outfitsOf(result)) expect(added).toHaveLength(Object.values(outfit).length);
  });

  test("with a 옷장 that makes no 코디, keeping an owned piece adds only what is missing", async () => {
    const outfit = await createTestOutfit({ today: DATE });
    const userId = await outfit.createUser("minji@gmail.com");
    const [tee] = await outfit.addClothes(userId, [{ name: "흰 티", slot: "top", color: "white" }]);
    outfit.pieceAdviser.willProposeOutfits([{ pieces: [BROWN_CARDIGAN, BEIGE_PANTS, WHITE_SNEAKERS] }]);
    const first = await outfit.recommender.purchaseOutfits({ userId, date: DATE, situation: null, location: SEOUL });
    expect(first.kind).toBe("all-new");
    outfit.llm.interpretPurchaseMessage("흰 티는 꼭 입을게", [{ type: "keep", clothingId: tee.id }]);

    const result = await outfit.recommender.revisePurchase({ userId, sessionId: first.sessionId, message: "흰 티는 꼭 입을게" });

    expect(result.kind).toBe("with-wardrobe");
    expect(outfitsOf(result).length).toBeGreaterThan(0);
    for (const { outfit: o, added } of outfitsOf(result)) {
      expect(o.top).toEqual(tee);
      expect(added.map((a) => a.clothing.slot).sort()).toEqual(["bottom", "shoes"]);
    }
  });
});

describe("구매 대화: 이력과 되돌리기", () => {
  test("구매 조건 add up over the session, and 되돌리기 goes back to the first 구매 추천", async () => {
    const { llm, recommender, userId, first, pieceAdviser, say } = await shopping();
    pieceAdviser.willProposeForRequest([piece({ name: "베이지 니트", slot: "top", color: "beige", material: "knit" })]);
    llm.interpretPurchaseMessage("더 밝은 색으로", [{ type: "color", direction: "lighter" }]);
    llm.interpretPurchaseMessage("니트로", [{ type: "material", material: "knit" }]);
    await say("더 밝은 색으로");

    const second = await say("니트로");

    expect(second.step).toBe(2);
    expect(second.conversation?.conditions).toEqual([
      { type: "color", direction: "lighter" },
      { type: "material", material: "knit" },
    ]);
    expect(addedOf(second)).toEqual([[expect.objectContaining({ name: "베이지 니트" })]]);

    const back = await recommender.undoPurchase({ userId, sessionId: first.sessionId, step: 0 });

    expect(back).toMatchObject({ step: 0, conversation: null });
    expect(addedOf(back)).toEqual(addedOf(first));
    expect(await recommender.latestPurchase({ userId, sessionId: first.sessionId })).toMatchObject({ step: 0 });
  });

  test("a 구매 추천 does not replace the 추천 세션 of the same date", async () => {
    const { recommender, userId } = await createTestOutfitWithOutfit();
    const main = await recommender.recommendForDate({ userId, date: DATE, situation: null, location: SEOUL });

    await recommender.purchaseOutfits({ userId, date: DATE, situation: null, location: SEOUL });

    expect(await recommender.latest({ userId, sessionId: main.sessionId })).not.toBeNull();
  });
});

describe("구매 대화: 반영하지 못한 말", () => {
  test.each<[string, string, AskedPurchaseCondition[]]>([
    ["off-topic", "오늘 점심 뭐 먹지?", [{ type: "off-topic" }]],
    ["unknown-clothing", "그 빨간 코트랑", [{ type: "keep", clothingId: "없는 옷" }]],
    ["unbuildable", "원피스로", [{ type: "slots", slots: ["dress"] }]],
  ])("%s leaves the 구매 추천 as it was", async (reason, message, conditions) => {
    const { llm, recommender, userId, first, say } = await shopping();
    llm.interpretPurchaseMessage(message, conditions);

    const result = await say(message);

    expect(result).toMatchObject({ step: 0, conversation: null, unapplied: { reason, message } });
    expect(addedOf(result)).toEqual(addedOf(first));
    expect(await recommender.latestPurchase({ userId, sessionId: first.sessionId })).toMatchObject({ step: 0 });
  });

  test("when the LLM cannot read the message, nothing changes", async () => {
    const { llm, say } = await shopping();
    llm.failWith();

    expect(await say("더 밝은 색으로")).toMatchObject({ step: 0, unapplied: { reason: "failed" } });
  });
});

describe("구매 대화: 비서 답장", () => {
  test("the 답장 is the LLM's, written from the 구매 조건 and the 코디 chosen", async () => {
    const { llm, say } = await shopping();
    llm.interpretPurchaseMessage("더 밝은 색으로", [{ type: "color", direction: "lighter" }]);

    const result = await say("더 밝은 색으로");

    expect(result.conversation?.reply).toBe(`${FAKE_SENTENCE} 답장`);
    expect(llm.replyRequests.at(-1)).toMatchObject({ message: "더 밝은 색으로", conditions: ["더 밝은 색으로"] });
  });

  test("when the LLM cannot write it, a template 답장 says what was asked", async () => {
    const { llm, say } = await shopping();
    llm.interpretPurchaseMessage("더 밝은 색으로", [{ type: "color", direction: "lighter" }]);
    llm.failRepliesWith();

    const result = await say("더 밝은 색으로");

    expect(result.conversation?.reply).toContain("더 밝은 색으로 요청에 맞춰");
  });
});

async function createTestOutfitWithOutfit() {
  const outfit = await createTestOutfit({ today: DATE });
  const userId = await outfit.createUser("minji@gmail.com");
  await outfit.addClothes(userId, [
    { name: "흰 티", slot: "top", color: "white" },
    { name: "검정 바지", slot: "bottom", color: "black" },
    { name: "검정 신발", slot: "shoes", color: "black" },
  ]);
  outfit.pieceAdviser.willPropose([BEIGE_PANTS]);
  return { ...outfit, userId };
}
