import { describe, expect, test } from "vitest";
import { createTestOutfit, SEOUL } from "./testing/harness";

const DATE = "2026-11-12";

// 민지, connected to her calendar, with a 옷장 that can dress her both
// casually and formally, and one 일정 the LLM judges a formal 결혼식.
async function minjiWithWedding() {
  const outfit = await createTestOutfit();
  const minji = await outfit.createUser("minji@gmail.com");
  outfit.calendar.connect(minji, ["personal"]);
  const [hoodie, shirt, jeans, slacks, sneakers, dressShoes] = await outfit.addClothes(minji, [
    { name: "후드티", slot: "top", formality: "casual" },
    { name: "흰 셔츠", slot: "top", formality: "formal" },
    { name: "청바지", slot: "bottom", formality: "casual" },
    { name: "정장 바지", slot: "bottom", formality: "formal" },
    { name: "운동화", slot: "shoes", formality: "casual" },
    { name: "구두", slot: "shoes", formality: "formal" },
  ]);
  const event = outfit.calendar.addEvent(minji, {
    calendarId: "personal",
    title: "동창 모임",
    start: `${DATE}T18:00:00+09:00`,
    end: `${DATE}T20:00:00+09:00`,
  });
  outfit.llm.judge("동창 모임", { kind: "wedding", formality: "formal" });
  return {
    ...outfit,
    minji,
    event,
    casual: { top: hoodie, bottom: jeans, shoes: sneakers },
    formal: { top: shirt, bottom: slacks, shoes: dressShoes },
  };
}

describe("일정 판단 직접 고치기", () => {
  test("after the 격식 수준 is corrected from formal to casual, the outfit is chosen for casual", async () => {
    const { recommender, minji, event, casual, formal } = await minjiWithWedding();
    const before = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });
    expect(before).toMatchObject({ outfit: formal });

    await recommender.correctEvent({
      userId: minji,
      eventId: event.id,
      judgement: { kind: "appointment", formality: "casual" },
    });
    const after = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(after).toMatchObject({
      status: "ok",
      events: [{ id: event.id, judgement: { kind: "appointment", formality: "casual" } }],
      basis: { kind: "appointment", formality: "casual" },
      outfit: casual,
    });
  });

  test("a corrected 일정 keeps its correction when loaded again, and the LLM is not asked about it", async () => {
    const { recommender, llm, minji, event } = await minjiWithWedding();
    await recommender.correctEvent({
      userId: minji,
      eventId: event.id,
      judgement: { kind: "date", formality: "semi-formal" },
    });

    const first = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });
    const again = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    for (const result of [first, again]) {
      expect(result).toMatchObject({
        events: [{ id: event.id, judgement: { kind: "date", formality: "semi-formal" } }],
        basis: { kind: "date", formality: "semi-formal" },
        missing: ["no-forecast"],
      });
    }
    expect(llm.judgeRequests).toEqual([]);
  });

  test("correcting the same 일정 again replaces the earlier correction", async () => {
    const { recommender, minji, event } = await minjiWithWedding();
    await recommender.correctEvent({ userId: minji, eventId: event.id, judgement: { kind: "date", formality: "semi-formal" } });
    await recommender.correctEvent({ userId: minji, eventId: event.id, judgement: { kind: "work", formality: "casual" } });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({ basis: { kind: "work", formality: "casual" } });
  });

  test("on a day with a corrected and an uncorrected 일정, only the uncorrected one goes to the LLM", async () => {
    const { recommender, calendar, llm, minji, event } = await minjiWithWedding();
    calendar.addEvent(minji, {
      calendarId: "personal",
      title: "출근",
      start: `${DATE}T09:00:00+09:00`,
      end: `${DATE}T17:00:00+09:00`,
    });
    llm.judge("출근", { kind: "work", formality: "semi-formal" });
    await recommender.correctEvent({
      userId: minji,
      eventId: event.id,
      judgement: { kind: "appointment", formality: "casual" },
    });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(llm.judgeRequests).toEqual([[{ title: "출근", description: null, location: null }]]);
    expect(result).toMatchObject({
      events: [
        { title: "출근", judgement: { kind: "work", formality: "semi-formal" } },
        { id: event.id, judgement: { kind: "appointment", formality: "casual" } },
      ],
      basis: { kind: "work", formality: "semi-formal" },
    });
  });

  test("when the LLM fails, a corrected 일정 still counts with its correction", async () => {
    const { recommender, calendar, llm, minji, event, casual } = await minjiWithWedding();
    const meeting = calendar.addEvent(minji, {
      calendarId: "personal",
      title: "주간 회의",
      start: `${DATE}T09:00:00+09:00`,
      end: `${DATE}T10:00:00+09:00`,
    });
    llm.failWith();
    await recommender.correctEvent({
      userId: minji,
      eventId: event.id,
      judgement: { kind: "appointment", formality: "casual" },
    });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({
      events: [
        { id: meeting.id, judgement: null },
        { id: event.id, judgement: { kind: "appointment", formality: "casual" } },
      ],
      baseEvent: { id: event.id },
      basis: { kind: "appointment", formality: "casual" },
      outfit: casual,
      missing: ["llm-failed", "no-forecast", "reasons-llm-failed"],
    });
  });

  test("another user's 일정 with the same 일정 식별자 is not affected by the correction", async () => {
    const { recommender, calendar, createUser, addClothes, minji, event } = await minjiWithWedding();
    const jisu = await createUser("jisu@gmail.com");
    calendar.connect(jisu, ["personal"]);
    await addClothes(jisu, [
      { name: "셔츠", slot: "top", formality: "formal" },
      { name: "정장 바지", slot: "bottom", formality: "formal" },
      { name: "구두", slot: "shoes", formality: "formal" },
    ]);
    calendar.addEvent(jisu, {
      id: event.id,
      calendarId: "personal",
      title: "동창 모임",
      start: `${DATE}T18:00:00+09:00`,
      end: `${DATE}T20:00:00+09:00`,
    });
    await recommender.correctEvent({
      userId: minji,
      eventId: event.id,
      judgement: { kind: "appointment", formality: "casual" },
    });

    const result = await recommender.recommendForDate({ userId: jisu, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({
      events: [{ id: event.id, judgement: { kind: "wedding", formality: "formal" } }],
      basis: { kind: "wedding", formality: "formal" },
    });
  });

  test("after 탈퇴 none of the user's corrections remain", async () => {
    const { recommender, llm, minji, event, deleteAccount } = await minjiWithWedding();
    await recommender.correctEvent({
      userId: minji,
      eventId: event.id,
      judgement: { kind: "appointment", formality: "casual" },
    });

    await deleteAccount(minji);
    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(llm.judgeRequests).toHaveLength(1);
    expect(result).toMatchObject({
      events: [{ id: event.id, judgement: { kind: "wedding", formality: "formal" } }],
    });
  });
});

describe("일정 판단 직접 고치기 during a 추천 세션", () => {
  test("continues the session: the outfit is chosen for the correction, the 수정 조건 so far are kept, and the step before can be gone back to", async () => {
    const { recommender, llm, addClothes, minji, event, casual, formal } = await minjiWithWedding();
    const [tee] = await addClothes(minji, [{ name: "티셔츠", slot: "top", formality: "casual" }]);
    const first = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });
    llm.interpret("후드티는 빼줘", [{ type: "exclude", clothingId: casual.top.id }]);
    const revised = await recommender.revise({ userId: minji, sessionId: first.sessionId, message: "후드티는 빼줘" });

    const corrected = await recommender.correctEvent({
      userId: minji,
      eventId: event.id,
      judgement: { kind: "appointment", formality: "casual" },
      sessionId: first.sessionId,
    });

    expect(corrected).toMatchObject({
      sessionId: first.sessionId,
      step: 2,
      basis: { kind: "appointment", formality: "casual" },
      outfit: { top: tee, bottom: casual.bottom, shoes: casual.shoes },
      revision: { conditions: [{ type: "exclude", clothing: casual.top }] },
    });
    expect(await recommender.latest({ userId: minji, sessionId: first.sessionId })).toMatchObject({
      step: 2,
      outfit: { top: tee },
    });
    expect(await recommender.undo({ userId: minji, sessionId: first.sessionId, step: 1 })).toMatchObject({
      outfit: formal,
      revision: revised.revision,
    });
  });
});

describe("캘린더 연동 해제", () => {
  test("after the calendar is disconnected, corrected 일정 go back to the LLM's judgement", async () => {
    const { recommender, minji, event, formal } = await minjiWithWedding();
    await recommender.correctEvent({
      userId: minji,
      eventId: event.id,
      judgement: { kind: "appointment", formality: "casual" },
    });

    await recommender.forgetCalendar(minji);
    const after = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(after).toMatchObject({
      events: [{ id: event.id, judgement: { kind: "wedding", formality: "formal" } }],
      outfit: formal,
    });
  });

  test("forgetting one user's calendar keeps another user's corrections", async () => {
    const outfit = await minjiWithWedding();
    const { recommender, calendar, minji, event } = outfit;
    const jun = await outfit.createUser("jun@gmail.com");
    calendar.connect(jun, ["personal"]);
    await outfit.addClothes(jun, [
      { name: "셔츠", slot: "top" },
      { name: "바지", slot: "bottom" },
      { name: "신발", slot: "shoes" },
    ]);
    const junEvent = calendar.addEvent(jun, {
      calendarId: "personal",
      title: "동창 모임",
      start: `${DATE}T18:00:00+09:00`,
      end: `${DATE}T20:00:00+09:00`,
    });
    for (const [userId, eventId] of [[minji, event.id], [jun, junEvent.id]]) {
      await recommender.correctEvent({ userId, eventId, judgement: { kind: "date", formality: "casual" } });
    }

    await recommender.forgetCalendar(minji);
    const junAfter = await recommender.recommendForDate({ userId: jun, date: DATE, situation: null, location: SEOUL });

    expect(junAfter).toMatchObject({
      events: [{ id: junEvent.id, judgement: { kind: "date", formality: "casual" } }],
    });
  });
});
