import { describe, expect, test } from "vitest";
import { SEOUL, createTestOutfit } from "./testing/harness";

const DATE = "2026-11-10";

describe("recommending an outfit from the 옷장 alone", () => {
  test("the outfit has a top, a bottom and shoes from the user's 옷장", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [tee, jeans, sneakers] = await addClothes(minji, [
      { name: "흰 티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.outfit).toEqual({ top: tee, bottom: jeans, shoes: sneakers });
  });

  test("another user's clothes never appear in the outfit", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const junho = await createUser("junho@gmail.com");
    await addClothes(junho, [
      { name: "준호 셔츠", slot: "top" },
      { name: "준호 바지", slot: "bottom" },
      { name: "준호 구두", slot: "shoes" },
    ]);
    const mine = await addClothes(minji, [
      { name: "민지 티셔츠", slot: "top" },
      { name: "민지 바지", slot: "bottom" },
      { name: "민지 운동화", slot: "shoes" },
    ]);

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(Object.values(result.outfit).map((c) => c.id).sort()).toEqual(mine.map((c) => c.id).sort());
  });

  test("a 원피스 with shoes is a complete outfit", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [dress, flats] = await addClothes(minji, [
      { name: "원피스", slot: "dress" },
      { name: "플랫슈즈", slot: "shoes" },
    ]);

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.outfit).toEqual({ dress, shoes: flats });
  });

  test("without shoes the 옷장 cannot make an outfit, and says shoes are missing", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    await addClothes(minji, [
      { name: "티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
    ]);

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({ status: "unbuildable", missingSlots: ["shoes"] });
  });

  test("tops without bottoms or a 원피스 cannot make an outfit, and say bottoms are missing", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    await addClothes(minji, [
      { name: "티셔츠", slot: "top" },
      { name: "운동화", slot: "shoes" },
    ]);

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({ status: "unbuildable", missingSlots: ["bottom"] });
  });
});

describe("색상 조합", () => {
  test("a neutral top is chosen over one whose color clashes with the bottoms", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, whiteTee] = await addClothes(minji, [
      { name: "빨간 티셔츠", slot: "top", color: "red" },
      { name: "흰 티셔츠", slot: "top", color: "white" },
      { name: "초록 바지", slot: "bottom", color: "green" },
      { name: "검은 운동화", slot: "shoes", color: "black" },
    ]);

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({ status: "ok", outfit: { top: whiteTee }, scores: { color: 1 } });
  });
});

describe("preferences", () => {
  test("a top in a preferred color is chosen over an otherwise equal top", async () => {
    const { recommender, wardrobe, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, navyTee] = await addClothes(minji, [
      { name: "회색 티셔츠", slot: "top", color: "gray" },
      { name: "남색 티셔츠", slot: "top", color: "navy" },
      { name: "청바지", slot: "bottom", color: "blue" },
      { name: "흰 운동화", slot: "shoes", color: "white" },
    ]);
    await wardrobe.setPreferences(minji, { colors: ["navy"], styles: [] });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({ status: "ok", outfit: { top: navyTee } });
  });

  test("a top in a preferred style is chosen over an otherwise equal top", async () => {
    const { recommender, wardrobe, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, streetTee] = await addClothes(minji, [
      { name: "기본 티셔츠", slot: "top", style: "casual" },
      { name: "그래픽 티셔츠", slot: "top", style: "street" },
      { name: "청바지", slot: "bottom", style: "casual" },
      { name: "운동화", slot: "shoes", style: "casual" },
    ]);
    await wardrobe.setPreferences(minji, { colors: [], styles: ["street"] });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({ status: "ok", outfit: { top: streetTee } });
  });
});

describe("recommending for a situation the user picked", () => {
  test("for a 면접 the outfit is made of formal clothes", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, shirt, , slacks, , loafers] = await addClothes(minji, [
      { name: "후드티", slot: "top", formality: "casual" },
      { name: "흰 셔츠", slot: "top", formality: "formal" },
      { name: "조거팬츠", slot: "bottom", formality: "casual" },
      { name: "정장 바지", slot: "bottom", formality: "formal" },
      { name: "운동화", slot: "shoes", formality: "casual" },
      { name: "구두", slot: "shoes", formality: "formal" },
    ]);

    const result = await recommender.recommendForDate({
      userId: minji,
      date: DATE,
      situation: "interview",
      location: SEOUL,
    });

    expect(result).toMatchObject({
      status: "ok",
      basis: { kind: "interview", formality: "formal" },
      outfit: { top: shirt, bottom: slacks, shoes: loafers },
    });
  });

  test("for a 면접 a 옷장 with only casual shoes cannot make an outfit", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    await addClothes(minji, [
      { name: "흰 셔츠", slot: "top", formality: "formal" },
      { name: "정장 바지", slot: "bottom", formality: "formal" },
      { name: "운동화", slot: "shoes", formality: "casual" },
    ]);

    const result = await recommender.recommendForDate({
      userId: minji,
      date: DATE,
      situation: "interview",
      location: SEOUL,
    });

    expect(result).toMatchObject({ status: "unbuildable", missingSlots: ["shoes"] });
  });

  test("for a 면접 without formal shoes, semi-formal shoes stand in", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, , loafers] = await addClothes(minji, [
      { name: "흰 셔츠", slot: "top", formality: "formal" },
      { name: "정장 바지", slot: "bottom", formality: "formal" },
      { name: "로퍼", slot: "shoes", formality: "semi-formal" },
      { name: "운동화", slot: "shoes", formality: "casual" },
    ]);

    const result = await recommender.recommendForDate({
      userId: minji,
      date: DATE,
      situation: "interview",
      location: SEOUL,
    });

    expect(result).toMatchObject({ status: "ok", outfit: { shoes: loafers } });
  });

  test("with 일정 없음 there is no basis and no 일정 score", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    await addClothes(minji, [
      { name: "흰 티셔츠", slot: "top", color: "white" },
      { name: "청바지", slot: "bottom", color: "blue" },
      { name: "검은 운동화", slot: "shoes", color: "black" },
    ]);

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.basis).toBeNull();
    expect(result.scores).toEqual({ color: 1, style: 1, preference: 0, recency: 1, utilization: 1 });
  });
});

describe("날씨", () => {
  test("on a 5°C day the outfit includes an outer", async () => {
    const { recommender, weather, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, , , coat] = await addClothes(minji, [
      { name: "맨투맨", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
      { name: "울 코트", slot: "outer", warmth: 3 },
    ]);
    weather.setForecast(DATE, { temperature: 5, rain: false });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({ status: "ok", outfit: { outer: coat } });
  });

  test("on a 25°C day there is no outer and thin clothes are chosen", async () => {
    const { recommender, weather, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, tee, , shorts, sneakers] = await addClothes(minji, [
      { name: "두꺼운 니트", slot: "top", warmth: 3 },
      { name: "반팔 티셔츠", slot: "top", warmth: 1 },
      { name: "기모 바지", slot: "bottom", warmth: 3 },
      { name: "반바지", slot: "bottom", warmth: 1 },
      { name: "운동화", slot: "shoes", warmth: 1 },
      { name: "울 코트", slot: "outer", warmth: 3 },
    ]);
    weather.setForecast(DATE, { temperature: 25, rain: false });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.outfit).toEqual({ top: tee, bottom: shorts, shoes: sneakers });
  });

  test("the result says which weather the outfit was chosen for", async () => {
    const { recommender, weather, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    await addClothes(minji, [
      { name: "티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);
    weather.setForecast(DATE, { temperature: 18, rain: true });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({ weather: { temperature: 18, rain: true }, missing: [] });
  });

  test("the weather is looked up for the date at the given location", async () => {
    const { recommender, weather, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    await addClothes(minji, [
      { name: "티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);

    await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(weather.requests).toEqual([{ date: DATE, ...SEOUL }]);
  });

  test("on a rainy day shoes that rain ruins lose out", async () => {
    const { recommender, weather, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, , , rainBoots] = await addClothes(minji, [
      { name: "티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "스웨이드 로퍼", slot: "shoes", material: "suede" },
      { name: "레인부츠", slot: "shoes", material: "synthetic" },
    ]);
    weather.setForecast(DATE, { temperature: 20, rain: true });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({ status: "ok", outfit: { shoes: rainBoots } });
  });

  test("on a dry day the same shoes are not penalized", async () => {
    const { recommender, weather, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, , loafers] = await addClothes(minji, [
      { name: "티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "스웨이드 로퍼", slot: "shoes", material: "suede" },
      { name: "레인부츠", slot: "shoes", material: "synthetic" },
    ]);
    weather.setForecast(DATE, { temperature: 20, rain: false });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({ status: "ok", outfit: { shoes: loafers }, scores: { weather: 1 } });
  });

  test("a date with no forecast is recommended without weather, saying so", async () => {
    const { recommender, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [tee, jeans, sneakers] = await addClothes(minji, [
      { name: "티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
      { name: "울 코트", slot: "outer", warmth: 3 },
    ]);

    const farOff = await recommender.recommendForDate({ userId: minji, date: "2026-12-25", situation: null, location: SEOUL });

    expect(farOff).toMatchObject({
      status: "ok",
      outfit: { top: tee, bottom: jeans, shoes: sneakers },
      weather: null,
      missing: ["no-forecast"],
    });
    if (farOff.status !== "ok") return;
    expect(farOff.outfit.outer).toBeUndefined();
    expect(farOff.scores.weather).toBeUndefined();
  });

  test("when the weather service fails the outfit is still recommended, saying weather failed", async () => {
    const { recommender, weather, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [tee, jeans, sneakers] = await addClothes(minji, [
      { name: "티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);
    weather.failWith();

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({
      status: "ok",
      outfit: { top: tee, bottom: jeans, shoes: sneakers },
      weather: null,
      missing: ["weather-failed"],
    });
  });
});

describe("캘린더 일정", () => {
  async function connectedMinji() {
    const outfit = await createTestOutfit();
    const minji = await outfit.createUser("minji@gmail.com");
    await outfit.addClothes(minji, [
      { name: "티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);
    outfit.calendar.connect(minji, ["personal"]);
    return { ...outfit, minji };
  }

  test("only the day's events from the calendars the user chose are in the result", async () => {
    const { recommender, calendar, minji } = await connectedMinji();
    const lunch = calendar.addEvent(minji, {
      calendarId: "personal",
      title: "점심 약속",
      start: `${DATE}T12:00:00+09:00`,
      end: `${DATE}T13:00:00+09:00`,
    });
    calendar.addEvent(minji, {
      calendarId: "holidays",
      title: "고르지 않은 캘린더의 일정",
      start: `${DATE}T09:00:00+09:00`,
      end: `${DATE}T10:00:00+09:00`,
    });
    calendar.addEvent(minji, {
      calendarId: "personal",
      title: "다음 날 일정",
      start: "2026-11-11T09:00:00+09:00",
      end: "2026-11-11T10:00:00+09:00",
    });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({ status: "ok", events: [lunch], baseEvent: lunch });
  });

  test("종일 일정 are included, and the day's events come in the order they happen", async () => {
    const { recommender, calendar, minji } = await connectedMinji();
    calendar.connect(minji, ["personal", "work"]);
    const dinner = calendar.addEvent(minji, {
      calendarId: "personal",
      title: "저녁 약속",
      start: `${DATE}T18:00:00+09:00`,
      end: `${DATE}T20:00:00+09:00`,
    });
    const workshop = calendar.addEvent(minji, {
      calendarId: "personal",
      title: "워크숍",
      start: DATE,
      end: "2026-11-11",
    });
    const meeting = calendar.addEvent(minji, {
      calendarId: "work",
      title: "팀 회의",
      start: `${DATE}T09:00:00+09:00`,
      end: `${DATE}T10:00:00+09:00`,
    });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result.events).toEqual([workshop, meeting, dinner]);
    expect(workshop.allDay).toBe(true);
  });

  test("for an 일정 in another region the weather there is used", async () => {
    const { recommender, calendar, weather, minji } = await connectedMinji();
    calendar.addEvent(minji, {
      calendarId: "personal",
      title: "친구 결혼식",
      start: `${DATE}T12:00:00+09:00`,
      end: `${DATE}T14:00:00+09:00`,
      location: "부산광역시 해운대구 센텀남대로 35",
    });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(weather.requests).toEqual([{ date: DATE, latitude: 35.1796, longitude: 129.0756 }]);
    expect(result.weatherPlace).toBe("부산");
  });

  test.each([
    ["has no 장소", null],
    ["has a 장소 that names no known place", "우리 집"],
  ])("for an 일정 that %s the 기본 지역's weather is used", async (_, location) => {
    const { recommender, calendar, weather, minji } = await connectedMinji();
    calendar.addEvent(minji, {
      calendarId: "personal",
      title: "스터디",
      start: `${DATE}T19:00:00+09:00`,
      end: `${DATE}T21:00:00+09:00`,
      location,
    });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(weather.requests).toEqual([{ date: DATE, ...SEOUL }]);
    expect(result.weatherPlace).toBeNull();
  });

  test("when the 연동 has expired the outfit comes without 일정, saying the calendar failed", async () => {
    const { recommender, calendar, weather, minji } = await connectedMinji();
    calendar.addEvent(minji, {
      calendarId: "personal",
      title: "점심 약속",
      start: `${DATE}T12:00:00+09:00`,
      end: `${DATE}T13:00:00+09:00`,
    });
    calendar.expire(minji);
    weather.setForecast(DATE, { temperature: 20, rain: false });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({
      status: "ok",
      events: [],
      baseEvent: null,
      missing: ["calendar-reconnect-needed"],
    });
  });

  test("when Google refuses the connection while reading 일정, it counts as expired", async () => {
    const { recommender, calendar, weather, minji } = await connectedMinji();
    calendar.addEvent(minji, {
      calendarId: "personal",
      title: "점심 약속",
      start: `${DATE}T12:00:00+09:00`,
      end: `${DATE}T13:00:00+09:00`,
    });
    calendar.revokeAtGoogle(minji);
    weather.setForecast(DATE, { temperature: 20, rain: false });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({ status: "ok", events: [], missing: ["calendar-reconnect-needed"] });
  });

  test("when the calendar cannot be read the outfit comes without 일정, saying the calendar failed", async () => {
    const { recommender, calendar, weather, minji } = await connectedMinji();
    calendar.failWith();
    weather.setForecast(DATE, { temperature: 20, rain: false });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({ status: "ok", events: [], baseEvent: null, missing: ["calendar-failed"] });
  });

  test("a user without 캘린더 연동 is recommended for the situation they picked, without reading any calendar", async () => {
    const { recommender, calendar, createUser, addClothes } = await createTestOutfit();
    const junho = await createUser("junho@gmail.com");
    await addClothes(junho, [
      { name: "셔츠", slot: "top", formality: "semi-formal" },
      { name: "슬랙스", slot: "bottom", formality: "semi-formal" },
      { name: "로퍼", slot: "shoes", formality: "semi-formal" },
    ]);

    const result = await recommender.recommendForDate({ userId: junho, date: DATE, situation: "work", location: SEOUL });

    expect(calendar.eventRequests).toEqual([]);
    expect(result).toMatchObject({
      status: "ok",
      events: [],
      baseEvent: null,
      basis: { kind: "work", formality: "semi-formal" },
      missing: ["no-forecast"],
    });
  });
});
