import { describe, expect, test } from "vitest";
import { FAKE_SENTENCE, SEOUL, createTestOutfit } from "./testing/harness";

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

  test("the 옷장 lists clothes in the order they were added, even when added at the same moment", async () => {
    // Ties in the score go to the clothes listed first, so this order must
    // not change from one run to the next.
    const { wardrobe, createUser } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const names = Array.from({ length: 12 }, (_, n) => `흰 티셔츠 ${n}`);
    // Added without waiting for each other, so several share a 등록 time.
    await Promise.all(
      names.map((name) =>
        wardrobe.addClothing(minji, {
          name,
          slot: "top",
          color: "white",
          seasons: ["spring", "summer", "autumn", "winter"],
          style: "casual",
          formality: "casual",
          warmth: 2,
          material: "cotton",
        }),
      ),
    );

    expect((await wardrobe.clothes(minji)).map((c) => c.name)).toEqual(names);
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

  test("on a rainy 6°C day a winter long padding is chosen over a thin spring-and-autumn denim jacket", async () => {
    const { recommender, weather, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, , , , padding] = await addClothes(minji, [
      { name: "맨투맨", slot: "top", color: "gray" },
      { name: "청바지", slot: "bottom", color: "blue", material: "denim" },
      { name: "흰 운동화", slot: "shoes", color: "white", material: "leather" },
      // Added first, so it would win any tie.
      {
        name: "데님 재킷",
        slot: "outer",
        color: "blue",
        seasons: ["spring", "autumn"],
        warmth: 1,
        material: "denim",
      },
      { name: "검정 롱패딩", slot: "outer", color: "black", seasons: ["winter"], warmth: 3, material: "synthetic" },
    ]);
    weather.setForecast(DATE, { temperature: 6, rain: true });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({ status: "ok", outfit: { outer: padding } });
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
    // Only the suede shoes, so the check doesn't hang on how ties between
    // equally scored shoes are broken.
    const [, , loafers] = await addClothes(minji, [
      { name: "티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "스웨이드 로퍼", slot: "shoes", material: "suede" },
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

    expect(result.events).toMatchObject([workshop, meeting, dinner]);
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

describe("일정 분석", () => {
  async function connectedMinji() {
    const outfit = await createTestOutfit();
    const minji = await outfit.createUser("minji@gmail.com");
    outfit.calendar.connect(minji, ["personal"]);
    return { ...outfit, minji };
  }

  test("a 결혼식 is judged a formal 결혼식, and formal clothes are chosen for it", async () => {
    const { recommender, calendar, llm, addClothes, minji } = await connectedMinji();
    const [, shirt, , slacks, , dressShoes] = await addClothes(minji, [
      { name: "후드티", slot: "top", formality: "casual" },
      { name: "흰 셔츠", slot: "top", formality: "formal" },
      { name: "청바지", slot: "bottom", formality: "casual" },
      { name: "정장 바지", slot: "bottom", formality: "formal" },
      { name: "운동화", slot: "shoes", formality: "casual" },
      { name: "구두", slot: "shoes", formality: "formal" },
    ]);
    const wedding = calendar.addEvent(minji, {
      calendarId: "personal",
      title: "사촌 결혼식",
      start: `${DATE}T12:00:00+09:00`,
      end: `${DATE}T14:00:00+09:00`,
    });
    llm.judge("사촌 결혼식", { kind: "wedding", formality: "formal" });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({
      status: "ok",
      events: [{ ...wedding, judgement: { kind: "wedding", formality: "formal" } }],
      baseEvent: { id: wedding.id },
      basis: { kind: "wedding", formality: "formal" },
      outfit: { top: shirt, bottom: slacks, shoes: dressShoes },
      missing: ["no-forecast"],
    });
  });

  test("on a day with 출근 and a 결혼식, the 결혼식 is the 기준 일정", async () => {
    const { recommender, calendar, llm, addClothes, minji } = await connectedMinji();
    await addClothes(minji, [
      { name: "셔츠", slot: "top", formality: "formal" },
      { name: "정장 바지", slot: "bottom", formality: "formal" },
      { name: "구두", slot: "shoes", formality: "formal" },
    ]);
    calendar.addEvent(minji, {
      calendarId: "personal",
      title: "출근",
      start: `${DATE}T09:00:00+09:00`,
      end: `${DATE}T12:00:00+09:00`,
    });
    const wedding = calendar.addEvent(minji, {
      calendarId: "personal",
      title: "동기 결혼식",
      start: `${DATE}T18:00:00+09:00`,
      end: `${DATE}T20:00:00+09:00`,
      location: "부산광역시 해운대구",
    });
    llm.judge("출근", { kind: "work", formality: "semi-formal" });
    llm.judge("동기 결혼식", { kind: "wedding", formality: "formal" });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({
      events: [
        { title: "출근", judgement: { kind: "work", formality: "semi-formal" } },
        { title: "동기 결혼식", judgement: { kind: "wedding", formality: "formal" } },
      ],
      baseEvent: { id: wedding.id },
      basis: { kind: "wedding", formality: "formal" },
      weatherPlace: "부산",
    });
  });

  test("clothes far from the formality of the day's other 일정 are chosen less than otherwise equal clothes", async () => {
    const { recommender, calendar, llm, addClothes, minji } = await connectedMinji();
    // No semi-formal shoes for 출근: formal and casual shoes are equally one
    // level off, but formal shoes are two levels off the 운동 later.
    const [, , , sneakers] = await addClothes(minji, [
      { name: "셔츠", slot: "top", formality: "semi-formal" },
      { name: "슬랙스", slot: "bottom", formality: "semi-formal" },
      { name: "구두", slot: "shoes", formality: "formal" },
      { name: "운동화", slot: "shoes", formality: "casual" },
    ]);
    calendar.addEvent(minji, {
      calendarId: "personal",
      title: "출근",
      start: `${DATE}T09:00:00+09:00`,
      end: `${DATE}T18:00:00+09:00`,
    });
    calendar.addEvent(minji, {
      calendarId: "personal",
      title: "헬스",
      start: `${DATE}T19:00:00+09:00`,
      end: `${DATE}T20:00:00+09:00`,
    });
    llm.judge("출근", { kind: "work", formality: "semi-formal" });
    llm.judge("헬스", { kind: "workout", formality: "casual" });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({
      basis: { kind: "work", formality: "semi-formal" },
      outfit: { shoes: sneakers },
    });
  });

  test("the user's picked situation does not replace the judged 일정", async () => {
    const { recommender, calendar, llm, addClothes, minji } = await connectedMinji();
    await addClothes(minji, [
      { name: "셔츠", slot: "top", formality: "formal" },
      { name: "정장 바지", slot: "bottom", formality: "formal" },
      { name: "구두", slot: "shoes", formality: "formal" },
    ]);
    calendar.addEvent(minji, {
      calendarId: "personal",
      title: "최종 면접",
      start: `${DATE}T10:00:00+09:00`,
      end: `${DATE}T11:00:00+09:00`,
    });
    llm.judge("최종 면접", { kind: "interview", formality: "formal" });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: "workout", location: SEOUL });

    expect(result).toMatchObject({ basis: { kind: "interview", formality: "formal" } });
  });

  test("the LLM is told each 일정's title, 메모 and 장소, and nothing else", async () => {
    const { recommender, calendar, llm, addClothes, minji } = await connectedMinji();
    await addClothes(minji, [
      { name: "티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);
    calendar.addEvent(minji, {
      calendarId: "personal",
      title: "팀 회식",
      start: `${DATE}T19:00:00+09:00`,
      end: `${DATE}T21:00:00+09:00`,
      location: "강남역 고깃집",
      description: "김부장, 이대리 참석",
    });
    calendar.addEvent(minji, { calendarId: "personal", title: "휴가", start: DATE, end: "2026-11-11" });
    llm.judge("팀 회식", { kind: "appointment", formality: "casual" });
    llm.judge("휴가", { kind: "appointment", formality: "casual" });

    await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(llm.judgeRequests).toEqual([
      [
        { title: "휴가", description: null, location: null },
        { title: "팀 회식", description: "김부장, 이대리 참석", location: "강남역 고깃집" },
      ],
    ]);
  });

  test("a day without 일정 asks the LLM nothing", async () => {
    const { recommender, llm, addClothes, minji } = await connectedMinji();
    await addClothes(minji, [
      { name: "티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(llm.judgeRequests).toEqual([]);
    expect(result.missing).toEqual(["no-forecast"]);
  });

  test("when the LLM fails, the outfit comes for the picked situation, saying the LLM failed", async () => {
    const { recommender, calendar, llm, addClothes, minji } = await connectedMinji();
    const [, shirt, , slacks, , loafers] = await addClothes(minji, [
      { name: "후드티", slot: "top", formality: "casual" },
      { name: "셔츠", slot: "top", formality: "semi-formal" },
      { name: "조거팬츠", slot: "bottom", formality: "casual" },
      { name: "슬랙스", slot: "bottom", formality: "semi-formal" },
      { name: "운동화", slot: "shoes", formality: "casual" },
      { name: "로퍼", slot: "shoes", formality: "semi-formal" },
    ]);
    const meeting = calendar.addEvent(minji, {
      calendarId: "personal",
      title: "주간 회의",
      start: `${DATE}T09:00:00+09:00`,
      end: `${DATE}T10:00:00+09:00`,
    });
    llm.failWith();

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: "work", location: SEOUL });

    expect(result).toMatchObject({
      status: "ok",
      events: [{ id: meeting.id, judgement: null }],
      baseEvent: { id: meeting.id },
      basis: { kind: "work", formality: "semi-formal" },
      outfit: { top: shirt, bottom: slacks, shoes: loafers },
      missing: ["llm-failed", "no-forecast", "reasons-llm-failed"],
    });
  });

  test("when the LLM fails and no situation was picked, the outfit still comes, for 일정 없음", async () => {
    const { recommender, calendar, llm, addClothes, minji } = await connectedMinji();
    await addClothes(minji, [
      { name: "티셔츠", slot: "top" },
      { name: "청바지", slot: "bottom" },
      { name: "운동화", slot: "shoes" },
    ]);
    calendar.addEvent(minji, {
      calendarId: "personal",
      title: "주간 회의",
      start: `${DATE}T09:00:00+09:00`,
      end: `${DATE}T10:00:00+09:00`,
    });
    llm.failWith();

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({ status: "ok", basis: null, missing: ["llm-failed", "no-forecast", "reasons-llm-failed"] });
  });
});

describe("추천 이유", () => {
  async function connectedMinji() {
    const outfit = await createTestOutfit();
    const minji = await outfit.createUser("minji@gmail.com");
    outfit.calendar.connect(minji, ["personal"]);
    return { ...outfit, minji };
  }

  test("the reasons are the factors that added most to the score, each with its clothes and facts", async () => {
    const { recommender, calendar, llm, weather, addClothes, minji } = await connectedMinji();
    // One piece per slot, so the 코디 is fixed. Every piece suits the 5°C day
    // and the formal 결혼식 perfectly, and none was ever worn, while the red
    // top and the blue slacks clash.
    const [top, slacks, shoes, coat] = await addClothes(minji, [
      { name: "빨간 블라우스", slot: "top", color: "red", formality: "formal", warmth: 3 },
      { name: "파란 정장 바지", slot: "bottom", color: "blue", formality: "formal", warmth: 3 },
      { name: "구두", slot: "shoes", formality: "formal", warmth: 3 },
      { name: "울 코트", slot: "outer", formality: "formal", warmth: 2, material: "wool" },
    ]);
    weather.setForecast(DATE, { temperature: 5, rain: false });
    calendar.addEvent(minji, {
      calendarId: "personal",
      title: "사촌 결혼식",
      start: `${DATE}T12:00:00+09:00`,
      end: `${DATE}T14:00:00+09:00`,
    });
    llm.judge("사촌 결혼식", { kind: "wedding", formality: "formal" });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.outfit).toEqual({ top, bottom: slacks, shoes, outer: coat });
    expect(result.reasons.map((r) => r.evidence.factor).sort()).toEqual(["event", "recency", "weather"]);
    const evidence = (factor: string) => result.reasons.find((r) => r.evidence.factor === factor)!.evidence;
    expect(evidence("weather")).toMatchObject({
      facts: { temperature: 5, rain: false },
      clothes: expect.arrayContaining([coat]),
    });
    expect(evidence("event")).toMatchObject({
      facts: { kind: "wedding", formality: "formal", title: "사촌 결혼식" },
      clothes: expect.arrayContaining([top, slacks, shoes, coat]),
    });
    expect(evidence("recency")).toMatchObject({
      clothes: expect.arrayContaining([top, slacks, shoes, coat]),
    });
  });

  test("without weather or 일정, matching colors and preferences are among the reasons", async () => {
    const { recommender, wardrobe, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    // Neutral colors throughout, all in the color minji likes, none ever worn.
    const [tee, jeans, sneakers] = await addClothes(minji, [
      { name: "네이비 티셔츠", slot: "top", color: "navy" },
      { name: "네이비 바지", slot: "bottom", color: "navy" },
      { name: "네이비 운동화", slot: "shoes", color: "navy" },
    ]);
    await wardrobe.setPreferences(minji, { colors: ["navy"], styles: [] });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.reasons.map((r) => r.evidence.factor).sort()).toEqual(["color", "preference", "recency"]);
    const evidence = (factor: string) => result.reasons.find((r) => r.evidence.factor === factor)!.evidence;
    expect(evidence("color")).toMatchObject({ facts: { colors: ["navy"], accents: [] } });
    expect(evidence("preference")).toMatchObject({
      clothes: expect.arrayContaining([tee, jeans, sneakers]),
      facts: { colors: ["navy"], styles: [] },
    });
  });

  test("the LLM is given only the 근거, and writes a sentence for each", async () => {
    const { recommender, llm, weather, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    await addClothes(minji, [
      { name: "맨투맨", slot: "top", warmth: 3 },
      { name: "청바지", slot: "bottom", warmth: 3 },
      { name: "운동화", slot: "shoes", warmth: 3 },
    ]);
    weather.setForecast(DATE, { temperature: 5, rain: false });

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    expect(result.reasons.length).toBeLessThanOrEqual(3);
    expect(llm.reasonRequests).toEqual([result.reasons.map((r) => r.evidence)]);
    for (const reason of result.reasons) expect(reason.sentence.startsWith(FAKE_SENTENCE)).toBe(true);
    expect(result.missing).toEqual([]);
  });

  test("when the LLM cannot write sentences, each 근거 gets a template sentence, saying so", async () => {
    const { recommender, llm, weather, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    const [, , , coat] = await addClothes(minji, [
      { name: "맨투맨", slot: "top", warmth: 3 },
      { name: "청바지", slot: "bottom", warmth: 3 },
      { name: "운동화", slot: "shoes", warmth: 3 },
      { name: "패딩", slot: "outer", warmth: 2 },
    ]);
    weather.setForecast(DATE, { temperature: 5, rain: false });
    llm.failWith();

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.missing).toEqual(["reasons-llm-failed"]);
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    expect(result.reasons.length).toBeLessThanOrEqual(3);
    for (const reason of result.reasons) {
      expect(reason.sentence.trim()).not.toBe("");
      expect(reason.sentence.startsWith(FAKE_SENTENCE)).toBe(false);
    }
    expect(result.reasons.find((r) => r.evidence.factor === "weather")?.evidence).toMatchObject({
      facts: { temperature: 5 },
      clothes: expect.arrayContaining([coat]),
    });
  });

  test("an outfit that cannot be made has no reasons, and the LLM is not asked for any", async () => {
    const { recommender, llm, createUser, addClothes } = await createTestOutfit();
    const minji = await createUser("minji@gmail.com");
    await addClothes(minji, [{ name: "티셔츠", slot: "top" }]);

    const result = await recommender.recommendForDate({ userId: minji, date: DATE, situation: null, location: SEOUL });

    expect(result).not.toHaveProperty("reasons");
    expect(llm.reasonRequests).toEqual([]);
  });
});
