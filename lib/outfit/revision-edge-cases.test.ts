import { describe, expect, test } from "vitest";
import { SEOUL, createTestOutfit } from "./testing/harness";
import type { Clothing } from "./wardrobe";

const DATE = "2026-11-10";

const formalities = (outfit: Record<string, Clothing>) => Object.values(outfit).map((c) => c.formality);

// A 옷장 with a full 코디 at each 격식 수준, and the 코디 first recommended for
// `situation`.
async function minjiFor(situation: "wedding" | "work") {
  const outfit = await createTestOutfit();
  const minji = await outfit.createUser("minji@gmail.com");
  await outfit.addClothes(minji, [
    { name: "드레스 셔츠", slot: "top", formality: "formal" },
    { name: "정장 바지", slot: "bottom", formality: "formal" },
    { name: "구두", slot: "shoes", formality: "formal" },
    { name: "옥스퍼드 셔츠", slot: "top", formality: "semi-formal" },
    { name: "슬랙스", slot: "bottom", formality: "semi-formal" },
    { name: "로퍼", slot: "shoes", formality: "semi-formal" },
    { name: "티셔츠", slot: "top", formality: "casual" },
    { name: "청바지", slot: "bottom", formality: "casual" },
    { name: "반바지", slot: "bottom", formality: "casual" },
    { name: "운동화", slot: "shoes", formality: "casual" },
  ]);
  outfit.llm.interpret("좀 더 캐주얼하게", [{ type: "style", direction: "casual" }]);
  outfit.llm.interpret("오늘 점심 뭐 먹지?", [{ type: "off-topic" }]);
  outfit.llm.interpret("바지만 바꿔줘", ({ outfit: shown }) => [
    { type: "exclude", clothingId: shown.find((c) => c.slot === "bottom")!.id },
  ]);
  const first = await outfit.recommender.recommendForDate({ userId: minji, date: DATE, situation, location: SEOUL });
  if (first.status !== "ok") throw new Error("expected an outfit");
  return { ...outfit, minji, first };
}

describe("구성 불가", () => {
  test("\"이 바지 말고\" with no other trousers says which 수정 조건 cannot be met and keeps the outfit", async () => {
    const { recommender, llm, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, jeans] = await addClothes(minji, [
      { name: "티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);
    const first = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });
    if (first.status !== "ok") throw new Error("expected an outfit");
    llm.interpret("이 바지 말고", [{ type: "exclude", clothingId: jeans.id }]);

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "이 바지 말고" });

    expect(revised).toMatchObject({
      status: "ok",
      outfit: first.outfit,
      revision: null,
      unapplied: { reason: "unbuildable", message: "이 바지 말고", unmet: [{ type: "exclude", clothing: jeans }] },
    });
    expect(await recommender.latest({ userId: minji, sessionId: first.sessionId })).toMatchObject({
      outfit: first.outfit,
      revision: null,
    });
  });

  test("names only the 수정 조건 that cannot be met, not the earlier ones that still can", async () => {
    const { recommender, llm, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, , jeans] = await addClothes(minji, [
      { name: "흰 티셔츠", slot: "top", color: "white" },
      { name: "검정 티셔츠", slot: "top", color: "black" },
      { name: "청바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);
    const first = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });
    llm.interpret("밝은 색으로", [{ type: "color", direction: "lighter" }]);
    llm.interpret("이 바지 말고", [{ type: "exclude", clothingId: jeans.id }]);
    const lighter = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "밝은 색으로" });

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "이 바지 말고" });

    expect(revised.unapplied).toMatchObject({ reason: "unbuildable", unmet: [{ type: "exclude", clothing: jeans }] });
    expect(revised.revision).toEqual(lighter.revision);
  });

  test("\"밝은 색으로\" when the 옷장 has nothing light says the 색상 방향 cannot be met and keeps the outfit", async () => {
    const { recommender, llm, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    await addClothes(minji, [
      { name: "검정 티셔츠", slot: "top", color: "black" },
      { name: "남색 티셔츠", slot: "top", color: "navy" },
      { name: "검정 바지", slot: "bottom", color: "black" },
      { name: "검정 운동화", slot: "shoes", color: "black" },
    ]);
    const first = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });
    if (first.status !== "ok") throw new Error("expected an outfit");
    llm.interpret("밝은 색으로", [{ type: "color", direction: "lighter" }]);

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "밝은 색으로" });

    expect(revised).toMatchObject({
      outfit: first.outfit,
      revision: null,
      unapplied: { reason: "unbuildable", unmet: [{ type: "color", direction: "lighter" }], missingSlots: [] },
    });
  });
});

describe("스타일 방향의 끝", () => {
  test("\"포멀하게\" for a 결혼식 already at the most formal says so and keeps the outfit", async () => {
    const { recommender, llm, minji, first } = await minjiFor("wedding");
    llm.interpret("좀 더 포멀하게", [{ type: "style", direction: "formal" }]);

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 포멀하게" });

    expect(revised).toMatchObject({
      outfit: first.outfit,
      revision: null,
      unapplied: { reason: "style-limit", message: "좀 더 포멀하게", direction: "formal" },
    });
  });

  test("\"캐주얼하게\" asked again says the outfit is already as casual as it goes", async () => {
    const { recommender, minji, first } = await minjiFor("work");
    const casual = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 캐주얼하게" });

    const again = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 캐주얼하게" });

    expect(again).toMatchObject({
      step: casual.step,
      revision: casual.revision,
      unapplied: { reason: "style-limit", direction: "casual" },
    });
  });
});

describe("무관한 메시지", () => {
  test("leaves the outfit as it was and says to ask about the outfit instead", async () => {
    const { recommender, minji, first } = await minjiFor("work");
    const casual = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 캐주얼하게" });

    const answered = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "오늘 점심 뭐 먹지?" });

    expect(answered).toMatchObject({
      status: "ok",
      outfit: casual.status === "ok" ? casual.outfit : undefined,
      revision: casual.revision,
      unapplied: { reason: "off-topic", message: "오늘 점심 뭐 먹지?" },
    });
  });

  test("is not added to the 수정 조건 kept for later messages", async () => {
    const { recommender, minji, first } = await minjiFor("work");
    const casual = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 캐주얼하게" });
    if (casual.status !== "ok") throw new Error("expected an outfit");
    await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "오늘 점심 뭐 먹지?" });

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "바지만 바꿔줘" });

    expect(revised.revision?.conditions).toEqual([
      { type: "style", direction: "casual" },
      { type: "exclude", clothing: casual.outfit.bottom },
    ]);
  });
});

describe("옷장에 없는 옷을 가리킨 메시지", () => {
  test("leaves the outfit as it was and says the piece could not be identified", async () => {
    const { recommender, llm, minji, first } = await minjiFor("work");
    llm.interpret("그 빨간 코트 말고", [{ type: "exclude", clothingId: "no-such-clothing" }]);

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "그 빨간 코트 말고" });

    expect(revised).toMatchObject({
      outfit: first.outfit,
      revision: null,
      unapplied: { reason: "unknown-clothing", message: "그 빨간 코트 말고" },
    });
  });
});

describe("되돌리기", () => {
  test("back to the first 추천 brings back its outfit and no 수정 조건", async () => {
    const { recommender, minji, first } = await minjiFor("work");
    await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 캐주얼하게" });
    await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "바지만 바꿔줘" });

    const undone = await recommender.undo({ userId: minji, sessionId: first.sessionId, step: 0 });

    expect(undone).toMatchObject({ status: "ok", outfit: first.outfit, revision: null, step: 0 });
    expect(await recommender.latest({ userId: minji, sessionId: first.sessionId })).toMatchObject({
      outfit: first.outfit,
      revision: null,
      step: 0,
    });
  });

  test("later messages build on the step gone back to", async () => {
    const { recommender, minji, first } = await minjiFor("work");
    const casual = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 캐주얼하게" });
    await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "바지만 바꿔줘" });
    expect(casual.step).toBe(1);

    if (casual.status !== "ok") throw new Error("expected an outfit");

    const undone = await recommender.undo({ userId: minji, sessionId: first.sessionId, step: 1 });
    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "바지만 바꿔줘" });

    expect(undone).toMatchObject({ revision: casual.revision, step: 1 });
    expect(revised.revision?.conditions).toEqual([
      { type: "style", direction: "casual" },
      { type: "exclude", clothing: casual.outfit.bottom },
    ]);
    expect(revised.step).toBe(2);
  });

  test("cannot go back in another user's session", async () => {
    const { recommender, createUser, first } = await minjiFor("work");
    const junho = await createUser("junho@gmail.com");

    await expect(recommender.undo({ userId: junho, sessionId: first.sessionId, step: 0 })).rejects.toThrow();
  });
});

describe("격식 충돌 경고", () => {
  test("\"캐주얼하게\" for a 결혼식 revises the outfit and warns that it clashes with the 일정", async () => {
    const { recommender, minji, first } = await minjiFor("wedding");
    expect(formalities(first.outfit)).toEqual(["formal", "formal", "formal"]);

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 캐주얼하게" });

    expect(revised.status).toBe("ok");
    if (revised.status !== "ok") return;
    expect(formalities(revised.outfit)).toEqual(["semi-formal", "semi-formal", "semi-formal"]);
    expect(revised.revision?.warnings).toEqual([
      {
        type: "formality-conflict",
        basis: { kind: "wedding", formality: "formal" },
        conditions: [{ type: "style", direction: "casual" }],
      },
    ]);
  });

  test("an outfit made less formal than its 결혼식 loses 일정 score, and no 추천 이유 says it suits the 결혼식", async () => {
    const { recommender, minji, first } = await minjiFor("wedding");
    expect(first).toMatchObject({ status: "ok", scores: { event: 1 } });

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 캐주얼하게" });

    expect(revised.status).toBe("ok");
    if (revised.status !== "ok") return;
    expect(revised.scores.event).toBeLessThan(1);
    for (const { evidence } of revised.reasons) {
      if (evidence.factor !== "event") continue;
      // What the 근거 says of the 일정 is the 일정's own 종류 and 격식 수준,
      // and only clothes at that 격식 수준 are said to suit it.
      expect(evidence.facts).toMatchObject({ kind: "wedding", formality: "formal" });
      expect(evidence.clothes.every((c) => c.formality === "formal")).toBe(true);
    }
  });
});
