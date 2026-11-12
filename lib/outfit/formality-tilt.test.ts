import { describe, expect, test } from "vitest";
import { createTestOutfit, SEOUL } from "./testing/harness";

const DATE = "2026-11-10";

// 민지 with a casual and a semi-formal outfit, who keeps asking for casual.
async function minji() {
  const outfit = await createTestOutfit({ today: DATE });
  const userId = await outfit.createUser("minji@gmail.com");
  const [hoodie, , jeans, , sneakers] = await outfit.addClothes(userId, [
    { name: "후드티", slot: "top", formality: "casual" },
    { name: "셔츠", slot: "top", formality: "semi-formal" },
    { name: "청바지", slot: "bottom", formality: "casual" },
    { name: "슬랙스", slot: "bottom", formality: "semi-formal" },
    { name: "운동화", slot: "shoes", formality: "casual" },
    { name: "로퍼", slot: "shoes", formality: "semi-formal" },
  ]);
  outfit.llm.interpret("더 캐주얼하게", [{ type: "style", direction: "casual" }]);
  const askCasual = async (times: number) => {
    for (let i = 0; i < times; i++) {
      const shown = await outfit.recommender.recommendForDate({ userId, date: DATE, situation: "work", location: SEOUL });
      await outfit.recommender.revise({ userId, sessionId: shown.sessionId, message: "더 캐주얼하게" });
    }
  };
  // 출근 is semi-formal, so without a 격식 기울기 the 셔츠 outfit is chosen.
  const workTop = async () => {
    const result = await outfit.recommender.recommendForDate({ userId, date: DATE, situation: "work", location: SEOUL });
    return result.status === "ok" ? result.outfit.top?.name : null;
  };
  return { ...outfit, userId, hoodie, jeans, sneakers, askCasual, workTop };
}

describe("격식 기울기", () => {
  test("asking 3 times for more casual tilts 일정-less days one step casual", async () => {
    const { recommender, userId, askCasual, workTop } = await minji();
    expect(await workTop()).toBe("셔츠");

    await askCasual(3);

    expect(await workTop()).toBe("후드티");
    expect(await recommender.tuning(userId)).toMatchObject({ tilt: "casual", tiltOff: false });
  });

  test("twice is not enough", async () => {
    const { askCasual, workTop } = await minji();

    await askCasual(2);

    expect(await workTop()).toBe("셔츠");
  });

  test("a day with a calendar 일정 keeps that 일정's 격식", async () => {
    const { recommender, calendar, llm, userId, askCasual } = await minji();
    await askCasual(3);
    calendar.connect(userId, ["personal"]);
    calendar.addEvent(userId, {
      calendarId: "personal",
      title: "팀 회의",
      start: `${DATE}T10:00:00+09:00`,
      end: `${DATE}T11:00:00+09:00`,
    });
    llm.judge("팀 회의", { kind: "work", formality: "semi-formal" });

    const result = await recommender.recommendForDate({ userId, date: DATE, situation: null, location: SEOUL });

    expect(result).toMatchObject({ status: "ok", outfit: { top: { name: "셔츠" } } });
  });

  test("turned off, the tilt is not applied", async () => {
    const { recommender, userId, askCasual, workTop } = await minji();
    await askCasual(3);

    await recommender.setTiltOff(userId, true);

    expect(await workTop()).toBe("셔츠");
    expect(await recommender.tuning(userId)).toMatchObject({ tilt: "casual", tiltOff: true });
  });

  test("going back to the start removes the tilt", async () => {
    const { recommender, userId, askCasual, workTop } = await minji();
    await askCasual(3);

    await recommender.resetTuning(userId);

    expect(await workTop()).toBe("셔츠");
    expect(await recommender.tuning(userId)).toMatchObject({ tilt: null });
  });
});
