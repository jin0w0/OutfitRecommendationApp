import { describe, expect, test } from "vitest";
import { FAKE_SENTENCE, SEOUL, createTestOutfit } from "./testing/harness";
import type { Clothing } from "./wardrobe";

const DATE = "2026-11-10";

const ids = (outfit: Record<string, Clothing>) => Object.values(outfit).map((c) => c.id);

describe("대화로 수정하기: 아이템 제외", () => {
  test("after \"이 바지 말고\" the outfit no longer has those trousers", async () => {
    const { recommender, llm, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    await addClothes(minji, [
      { name: "흰 티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "면바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);
    const first = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });
    if (first.status !== "ok") throw new Error("expected an outfit");
    const trousers = first.outfit.bottom!;
    llm.interpret("이 바지 말고 다른 걸로", [{ type: "exclude", clothingId: trousers.id }]);

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "이 바지 말고 다른 걸로" });

    expect(revised.status).toBe("ok");
    if (revised.status !== "ok") return;
    expect(ids(revised.outfit)).not.toContain(trousers.id);
    expect(revised.outfit.bottom).toBeDefined();
  });
});

describe("대화로 수정하기: 아이템 고정", () => {
  test("after \"이 셔츠는 꼭 입고 싶어\" the outfit has that shirt", async () => {
    const { recommender, llm, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [whiteShirt, stripedShirt] = await addClothes(minji, [
      { name: "흰 셔츠", slot: "top" },
      { name: "줄무늬 셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);
    const first = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });
    if (first.status !== "ok") throw new Error("expected an outfit");
    // Whichever shirt came first, ask for the other.
    const wanted = first.outfit.top!.id === whiteShirt.id ? stripedShirt : whiteShirt;
    llm.interpret("이 셔츠는 꼭 입고 싶어", [{ type: "keep", clothingId: wanted.id }]);

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "이 셔츠는 꼭 입고 싶어" });

    expect(revised.status).toBe("ok");
    if (revised.status !== "ok") return;
    expect(revised.outfit.top).toEqual(wanted);
  });

  test("a kept piece stays through a later 스타일 방향 it does not suit", async () => {
    const { recommender, llm, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [shirt] = await addClothes(minji, [
      { name: "셔츠", slot: "top", formality: "semi-formal" },
      { name: "티셔츠", slot: "top", formality: "casual" },
      { name: "슬랙스", slot: "bottom", formality: "semi-formal" },
      { name: "청바지", slot: "bottom", formality: "casual" },
      { name: "로퍼", slot: "shoes", formality: "semi-formal" },
      { name: "운동화", slot: "shoes", formality: "casual" },
    ]);
    const first = await recommender.recommendForDate({ userId: minji, date: DATE, situation: "work", location: SEOUL });
    llm.interpret("이 셔츠는 꼭 입고 싶어", [{ type: "keep", clothingId: shirt.id }]);
    llm.interpret("좀 더 캐주얼하게", [{ type: "style", direction: "casual" }]);
    await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "이 셔츠는 꼭 입고 싶어" });

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 캐주얼하게" });

    expect(revised.status).toBe("ok");
    if (revised.status !== "ok") return;
    expect(revised.outfit.top).toEqual(shirt);
    expect(revised.outfit.bottom!.formality).toBe("casual");
    expect(revised.outfit.shoes.formality).toBe("casual");
  });
});

// A 옷장 with a full 코디 at each 격식 수준, two casual bottoms among them,
// and the 코디 first recommended for 출근 (a semi-formal 일정).
async function minjiWithEveryFormality() {
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
  outfit.llm.interpret("좀 더 포멀하게", [{ type: "style", direction: "formal" }]);
  outfit.llm.interpret("바지만 바꿔줘", ({ outfit: shown }) => [
    { type: "exclude", clothingId: shown.find((c) => c.slot === "bottom")!.id },
  ]);
  const first = await outfit.recommender.recommendForDate({
    userId: minji,
    date: DATE,
    situation: "work",
    location: SEOUL,
  });
  if (first.status !== "ok") throw new Error("expected an outfit");
  return { ...outfit, minji, first };
}

const formalities = (outfit: Record<string, Clothing>) => Object.values(outfit).map((c) => c.formality);

describe("대화로 수정하기: 스타일 방향", () => {
  test("after \"캐주얼하게\" the outfit is made of less formal clothes than before", async () => {
    const { recommender, minji, first } = await minjiWithEveryFormality();
    expect(formalities(first.outfit)).toEqual(["semi-formal", "semi-formal", "semi-formal"]);

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 캐주얼하게" });

    expect(revised.status).toBe("ok");
    if (revised.status !== "ok") return;
    expect(formalities(revised.outfit)).toEqual(["casual", "casual", "casual"]);
    expect(revised.revision?.conditions).toEqual([{ type: "style", direction: "casual" }]);
  });

  test("\"바지만 바꿔줘\" after \"캐주얼하게\" keeps the outfit casual", async () => {
    const { recommender, minji, first } = await minjiWithEveryFormality();
    const casual = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 캐주얼하게" });
    if (casual.status !== "ok") throw new Error("expected an outfit");

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "바지만 바꿔줘" });

    expect(revised.status).toBe("ok");
    if (revised.status !== "ok") return;
    expect(revised.outfit.bottom!.id).not.toBe(casual.outfit.bottom!.id);
    expect(formalities(revised.outfit)).toEqual(["casual", "casual", "casual"]);
    expect(revised.revision?.conditions).toEqual([
      { type: "style", direction: "casual" },
      { type: "exclude", clothing: casual.outfit.bottom },
    ]);
  });

  test("\"포멀하게\" after \"캐주얼하게\" wins over it", async () => {
    const { recommender, minji, first } = await minjiWithEveryFormality();
    await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 캐주얼하게" });

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 포멀하게" });

    expect(revised.status).toBe("ok");
    if (revised.status !== "ok") return;
    expect(revised.revision?.conditions).toEqual([{ type: "style", direction: "formal" }]);
    expect(formalities(revised.outfit)).toEqual(["formal", "formal", "formal"]);
  });
});

describe("대화로 수정하기: 색상 방향", () => {
  test("after \"좀 더 밝은 색으로\" the outfit takes the light colors the 옷장 has", async () => {
    const { recommender, llm, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, whiteTee, , beigeChinos] = await addClothes(minji, [
      { name: "검정 티셔츠", slot: "top", color: "black" },
      { name: "흰 티셔츠", slot: "top", color: "white" },
      { name: "검정 바지", slot: "bottom", color: "black" },
      { name: "베이지 면바지", slot: "bottom", color: "beige" },
      { name: "검정 운동화", slot: "shoes", color: "black" },
    ]);
    const first = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });
    llm.interpret("좀 더 밝은 색으로", [{ type: "color", direction: "lighter" }]);

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 밝은 색으로" });

    expect(revised.status).toBe("ok");
    if (revised.status !== "ok") return;
    expect(revised.outfit.top).toEqual(whiteTee);
    expect(revised.outfit.bottom).toEqual(beigeChinos);
  });
});

describe("수정 조건의 충돌", () => {
  test("keeping a piece that was excluded before brings it back", async () => {
    const { recommender, llm, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    await addClothes(minji, [
      { name: "티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "면바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);
    const first = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });
    if (first.status !== "ok") throw new Error("expected an outfit");
    const trousers = first.outfit.bottom!;
    llm.interpret("이 바지 말고", [{ type: "exclude", clothingId: trousers.id }]);
    llm.interpret("아까 그 바지 다시 입을래", [{ type: "keep", clothingId: trousers.id }]);
    await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "이 바지 말고" });

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "아까 그 바지 다시 입을래" });

    expect(revised.status).toBe("ok");
    if (revised.status !== "ok") return;
    expect(revised.outfit.bottom).toEqual(trousers);
    expect(revised.revision?.conditions).toEqual([{ type: "keep", clothing: trousers }]);
  });

  test("keeping another piece for the same slot replaces the earlier one kept", async () => {
    const { recommender, llm, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [tee, shirt] = await addClothes(minji, [
      { name: "티셔츠", slot: "top" },
      { name: "셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);
    const first = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });
    llm.interpret("티셔츠 입을래", [{ type: "keep", clothingId: tee.id }]);
    llm.interpret("아니 셔츠 입을래", [{ type: "keep", clothingId: shirt.id }]);
    await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "티셔츠 입을래" });

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "아니 셔츠 입을래" });

    expect(revised.status).toBe("ok");
    if (revised.status !== "ok") return;
    expect(revised.outfit.top).toEqual(shirt);
    expect(revised.revision?.conditions).toEqual([{ type: "keep", clothing: shirt }]);
  });
});

describe("수정 결과", () => {
  test("says which slot changed, from what to what, and the 수정 조건 behind it", async () => {
    const { recommender, llm, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    await addClothes(minji, [
      { name: "티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "면바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);
    const first = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });
    if (first.status !== "ok") throw new Error("expected an outfit");
    const trousers = first.outfit.bottom!;
    llm.interpret("이 바지 말고", [{ type: "exclude", clothingId: trousers.id }]);

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "이 바지 말고" });

    expect(revised.status).toBe("ok");
    if (revised.status !== "ok") return;
    expect(revised.revision).toEqual({
      message: "이 바지 말고",
      conditions: [{ type: "exclude", clothing: trousers }],
      changes: [
        {
          slot: "bottom",
          from: trousers,
          to: revised.outfit.bottom,
          cause: { type: "exclude", clothing: trousers },
        },
      ],
    });
  });

  test("names the 스타일 방향 as the cause of pieces swapped for less formal ones", async () => {
    const { recommender, minji, first } = await minjiWithEveryFormality();

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 캐주얼하게" });

    expect(revised.revision?.changes.map(({ slot, cause }) => ({ slot, cause }))).toEqual([
      { slot: "top", cause: { type: "style", direction: "casual" } },
      { slot: "bottom", cause: { type: "style", direction: "casual" } },
      { slot: "shoes", cause: { type: "style", direction: "casual" } },
    ]);
  });

  test("comes with 추천 이유 for the revised outfit, in the same form as the first", async () => {
    const { recommender, minji, first } = await minjiWithEveryFormality();

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 캐주얼하게" });

    expect(revised.status).toBe("ok");
    if (revised.status !== "ok") return;
    expect(revised.reasons.length).toBeGreaterThan(0);
    const pieces = ids(revised.outfit);
    for (const { evidence, sentence } of revised.reasons) {
      expect(sentence.startsWith(FAKE_SENTENCE)).toBe(true);
      expect(evidence.clothes.every((c) => pieces.includes(c.id))).toBe(true);
    }
    expect(revised.reasons.find((r) => r.evidence.factor === "event")?.evidence).toMatchObject({
      facts: { kind: "work", formality: "casual" },
    });
  });

  test("is for the same day: the 일정 and weather found for the first", async () => {
    const { recommender, weather, minji, first } = await minjiWithEveryFormality();
    weather.setForecast(DATE, { temperature: 30, rain: false });

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 캐주얼하게" });

    expect(revised).toMatchObject({ date: DATE, basis: first.basis, weather: first.weather, missing: first.missing });
  });
});

describe("수정한 코디 입을게요", () => {
  test("the revised outfit can be accepted", async () => {
    const { recommender, minji, first } = await minjiWithEveryFormality();
    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 캐주얼하게" });
    if (revised.status !== "ok") throw new Error("expected an outfit");

    await recommender.accept({ userId: minji, date: DATE, clothingIds: ids(revised.outfit) });
    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: "work", location: SEOUL });

    expect(result.accepted?.status).toBe("worn");
    expect(result.accepted?.clothes.map((c) => c.id).sort()).toEqual(ids(revised.outfit).sort());
  });
});

describe("대화로 수정하기 when the LLM fails", () => {
  test("leaves the outfit as it was and says the message could not be read", async () => {
    const { recommender, llm, minji, first } = await minjiWithEveryFormality();
    llm.failWith();

    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 캐주얼하게" });

    expect(revised.status).toBe("ok");
    if (revised.status !== "ok") return;
    expect(revised.outfit).toEqual(first.outfit);
    expect(revised.missing).toContain("revision-llm-failed");
  });
});

describe("추천 세션", () => {
  test("shows its latest 수정 결과 again, with what was accepted since", async () => {
    const { recommender, minji, first } = await minjiWithEveryFormality();
    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 캐주얼하게" });
    if (revised.status !== "ok") throw new Error("expected an outfit");
    await recommender.accept({ userId: minji, date: DATE, clothingIds: ids(revised.outfit) });

    const shown = await recommender.latest({ userId: minji, sessionId: first.sessionId });

    expect(shown).toMatchObject({ outfit: revised.outfit, revision: revised.revision, accepted: { status: "worn" } });
  });

  test("starts over with every 날짜로 추천받기, forgetting the session before it", async () => {
    const { recommender, minji, first } = await minjiWithEveryFormality();

    const again = await recommender.recommendForDate({ userId: minji, date: DATE, situation: "work", location: SEOUL });

    expect(again.sessionId).not.toBe(first.sessionId);
    expect(await recommender.latest({ userId: minji, sessionId: first.sessionId })).toBeNull();
  });

  test("cannot be revised by another user", async () => {
    const { recommender, createUser, first } = await minjiWithEveryFormality();
    const junho = await createUser("junho@gmail.com");

    await expect(
      recommender.revise({ userId: junho, sessionId: first.sessionId, message: "좀 더 캐주얼하게" }),
    ).rejects.toThrow();
  });

  test("is gone after 탈퇴", async () => {
    const { recommender, deleteAccount, minji, first } = await minjiWithEveryFormality();

    await deleteAccount(minji);

    await expect(
      recommender.revise({ userId: minji, sessionId: first.sessionId, message: "좀 더 캐주얼하게" }),
    ).rejects.toThrow();
  });
});
