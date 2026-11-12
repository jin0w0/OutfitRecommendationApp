import { describe, expect, test } from "vitest";
import { createTestOutfit } from "./testing/harness";
import type { ClothingFields } from "./wardrobe";

const LONG_AGO = "2025-01-01";

// A piece the LLM might propose, plain unless said otherwise.
function candidate(fields: Partial<ClothingFields> & Pick<ClothingFields, "name" | "slot" | "color">): ClothingFields {
  return {
    seasons: ["spring", "summer", "autumn", "winter"],
    style: "street",
    formality: "casual",
    warmth: 2,
    material: "cotton",
    ...fields,
  };
}

// 민지's orange street top, which no bottom in her 옷장 goes with: the only
// bottom is green. Two street shoes would go with a neutral street bottom.
async function minjiWithOrangeTop() {
  const outfit = await createTestOutfit({ today: "2026-11-10" });
  const userId = await outfit.createUser("minji@gmail.com");
  const [orangeTop] = await outfit.addClothes(userId, [
    { name: "주황 티", slot: "top", color: "orange", style: "street", registeredOn: LONG_AGO },
    { name: "초록 바지", slot: "bottom", color: "green", style: "classic", registeredOn: LONG_AGO },
    { name: "검정 스트릿 스니커즈", slot: "shoes", color: "black", style: "street", registeredOn: LONG_AGO },
    { name: "흰 스트릿 스니커즈", slot: "shoes", color: "white", style: "street", registeredOn: LONG_AGO },
  ]);
  const revive = () => outfit.pieces.reviving(userId, orangeTop.id);
  return { ...outfit, userId, orangeTop, revive };
}

const BEIGE_PANTS = candidate({ name: "베이지 와이드 팬츠", slot: "bottom", color: "beige" });
const NAVY_PANTS = candidate({ name: "네이비 카고 팬츠", slot: "bottom", color: "navy" });
const GREEN_PANTS = candidate({ name: "초록 조거", slot: "bottom", color: "green" });

describe("조합 부족인 옷을 살리는 한 벌", () => {
  test("only pieces that bring 2 or more well-matched 코디 with the top are suggested, most first", async () => {
    const { pieceAdviser, revive } = await minjiWithOrangeTop();
    pieceAdviser.willPropose([GREEN_PANTS, BEIGE_PANTS, NAVY_PANTS]);

    const suggestions = await revive();

    expect(suggestions).toEqual([
      { id: expect.any(String), kind: "new", piece: BEIGE_PANTS, newOutfits: 2 },
      { id: expect.any(String), kind: "new", piece: NAVY_PANTS, newOutfits: 2 },
    ]);
  });

  test("at most 3, one per kind and color, none of the top's own kind", async () => {
    const { pieceAdviser, revive } = await minjiWithOrangeTop();
    pieceAdviser.willPropose([
      BEIGE_PANTS,
      { ...BEIGE_PANTS, name: "베이지 치노" },
      NAVY_PANTS,
      candidate({ name: "회색 와이드 팬츠", slot: "bottom", color: "gray" }),
      candidate({ name: "검정 와이드 팬츠", slot: "bottom", color: "black" }),
      candidate({ name: "흰 티", slot: "top", color: "white" }),
    ]);

    const names = (await revive()).map((s) => (s.kind === "new" ? s.piece.name : s.clothing.name));

    expect(names).toEqual(["베이지 와이드 팬츠", "네이비 카고 팬츠", "회색 와이드 팬츠"]);
  });

  test("a candidate with values outside the lists is dropped", async () => {
    const { pieceAdviser, revive } = await minjiWithOrangeTop();
    pieceAdviser.willPropose([{ ...BEIGE_PANTS, color: "teal" } as never, NAVY_PANTS]);

    expect((await revive()).map((s) => s.kind === "new" && s.piece.name)).toEqual(["네이비 카고 팬츠"]);
  });

  test("a piece like one already in the 옷장 is not suggested", async () => {
    const { pieceAdviser, addClothes, userId, revive } = await minjiWithOrangeTop();
    await addClothes(userId, [{ name: "가진 베이지 바지", slot: "bottom", color: "beige", formality: "casual" }]);
    pieceAdviser.willPropose([BEIGE_PANTS, NAVY_PANTS]);

    expect((await revive()).map((s) => s.kind === "new" && s.piece.name)).toEqual(["네이비 카고 팬츠"]);
  });

  test("a matching piece among the 정리한 옷 is suggested for restoring instead", async () => {
    const { pieceAdviser, closet, addClothes, userId, revive } = await minjiWithOrangeTop();
    const [tidiedBeige] = await addClothes(userId, [
      { name: "정리한 베이지 바지", slot: "bottom", color: "beige", style: "street", formality: "casual" },
    ]);
    await closet.tidy(userId, tidiedBeige.id);
    pieceAdviser.willPropose([BEIGE_PANTS]);

    expect(await revive()).toEqual([
      { id: expect.any(String), kind: "restore", clothing: expect.objectContaining({ id: tidiedBeige.id }), newOutfits: 2 },
    ]);
  });

  test("the LLM is asked again only once the 옷장 changes", async () => {
    const { pieceAdviser, addClothes, userId, revive } = await minjiWithOrangeTop();
    pieceAdviser.willPropose([BEIGE_PANTS]);

    await revive();
    await revive();
    expect(pieceAdviser.calls).toBe(1);

    await addClothes(userId, [{ name: "새 모자 대신 셔츠", slot: "top", color: "white" }]);
    await revive();
    expect(pieceAdviser.calls).toBe(2);
  });

  test("when the LLM fails, there is nothing to suggest", async () => {
    const { pieceAdviser, revive } = await minjiWithOrangeTop();
    pieceAdviser.failWith();

    expect(await revive()).toEqual([]);
  });

  test("someone else's piece gets no suggestions", async () => {
    const { pieces, pieceAdviser, createUser, orangeTop } = await minjiWithOrangeTop();
    const jun = await createUser("jun@gmail.com");
    pieceAdviser.willPropose([BEIGE_PANTS]);

    expect(await pieces.reviving(jun, orangeTop.id)).toEqual([]);
  });
});

describe("빈 종류를 채우는 한 벌", () => {
  test("with no shoes, only shoes that make a 코디 are suggested", async () => {
    const outfit = await createTestOutfit({ today: "2026-11-10" });
    const userId = await outfit.createUser("minji@gmail.com");
    await outfit.addClothes(userId, [
      { name: "흰 티", slot: "top", color: "white", style: "street" },
      { name: "검정 바지", slot: "bottom", color: "black", style: "street" },
    ]);
    const whiteSneakers = candidate({ name: "흰 스니커즈", slot: "shoes", color: "white" });
    const loudBoots = candidate({ name: "주황 부츠", slot: "shoes", color: "orange", style: "classic" });
    outfit.pieceAdviser.willPropose([BEIGE_PANTS, loudBoots, whiteSneakers]);

    const suggestions = await outfit.pieces.filling(userId, "shoes");

    expect(suggestions).toEqual([{ id: expect.any(String), kind: "new", piece: whiteSneakers, newOutfits: 1 }]);
  });
});

describe("관심 없어요", () => {
  test("a suggestion the user is not interested in is hidden for 90 days, for them only", async () => {
    const { pieces, pieceAdviser, setToday, createUser, addClothes, userId, revive } = await minjiWithOrangeTop();
    pieceAdviser.willPropose([BEIGE_PANTS, NAVY_PANTS]);
    const [beige] = await revive();

    await pieces.dismiss(userId, beige.id);
    expect((await revive()).map((s) => s.kind === "new" && s.piece.name)).toEqual(["네이비 카고 팬츠"]);

    setToday("2027-02-08");
    expect((await revive()).map((s) => s.kind === "new" && s.piece.name)).toEqual([
      "베이지 와이드 팬츠",
      "네이비 카고 팬츠",
    ]);

    const jun = await createUser("jun@gmail.com");
    const [junTop] = await addClothes(jun, [
      { name: "주황 티", slot: "top", color: "orange", style: "street" },
      { name: "검정 스트릿 스니커즈", slot: "shoes", color: "black", style: "street" },
      { name: "흰 스트릿 스니커즈", slot: "shoes", color: "white", style: "street" },
    ]);
    expect(await pieces.reviving(jun, junTop.id)).toHaveLength(2);
  });

  // 민지 with no shoes, shown three shoes that each make a 코디.
  async function minjiWithoutShoes() {
    const outfit = await createTestOutfit({ today: "2026-11-10" });
    const userId = await outfit.createUser("minji@gmail.com");
    await outfit.addClothes(userId, [
      { name: "흰 티", slot: "top", color: "white", style: "street" },
      { name: "검정 바지", slot: "bottom", color: "black", style: "street" },
    ]);
    const fill = () => outfit.pieces.filling(userId, "shoes");
    return { ...outfit, userId, fill };
  }
  const shoes = (name: string, color: ClothingFields["color"]) => candidate({ name, slot: "shoes", color });
  const names = (suggestions: Awaited<ReturnType<Awaited<ReturnType<typeof minjiWithoutShoes>>["fill"]>>) =>
    suggestions.map((s) => (s.kind === "new" ? s.piece.name : s.clothing.name));

  test("a dismissed suggestion's place is filled by a new one the LLM proposes, not like the dismissed", async () => {
    const { pieces, pieceAdviser, userId, fill } = await minjiWithoutShoes();
    pieceAdviser.willPropose([shoes("흰 스니커즈", "white"), shoes("검정 로퍼", "black"), shoes("회색 운동화", "gray")]);
    const [white] = await fill();
    pieceAdviser.willPropose([shoes("베이지 스니커즈", "beige")]);

    await pieces.dismiss(userId, white.id);

    expect(names(await fill())).toEqual(["검정 로퍼", "회색 운동화", "베이지 스니커즈"]);
    expect(pieceAdviser.avoidSeen.at(-1)).toContainEqual(expect.objectContaining({ slot: "shoes", color: "white" }));
  });

  test("while saved candidates still fill the list, the LLM is not asked again", async () => {
    const { pieces, pieceAdviser, userId, fill } = await minjiWithoutShoes();
    pieceAdviser.willPropose([
      shoes("흰 스니커즈", "white"),
      shoes("검정 로퍼", "black"),
      shoes("회색 운동화", "gray"),
      shoes("베이지 스니커즈", "beige"),
    ]);
    const [white] = await fill();

    await pieces.dismiss(userId, white.id);

    expect(names(await fill())).toEqual(["검정 로퍼", "회색 운동화", "베이지 스니커즈"]);
    expect(pieceAdviser.calls).toBe(1);
  });

  test("when the LLM fails to propose more, the dismissal still holds", async () => {
    const { pieces, pieceAdviser, userId, fill } = await minjiWithoutShoes();
    pieceAdviser.willPropose([shoes("흰 스니커즈", "white"), shoes("검정 로퍼", "black")]);
    const [white] = await fill();
    pieceAdviser.failWith();

    await pieces.dismiss(userId, white.id);

    expect(names(await fill())).toEqual(["검정 로퍼"]);
  });
});
