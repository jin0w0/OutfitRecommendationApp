import { describe, expect, test } from "vitest";
import { dayWeather, toKmaGrid } from "./kma-weather";

describe("기상청 격자 좌표", () => {
  test("Seoul's 위경도 is grid 60, 127", () => {
    expect(toKmaGrid({ latitude: 37.5665, longitude: 126.978 })).toEqual({ nx: 60, ny: 127 });
  });

  test("Busan's 위경도 is grid 98, 76", () => {
    expect(toKmaGrid({ latitude: 35.1796, longitude: 129.0756 })).toEqual({ nx: 98, ny: 76 });
  });
});

describe("하루 날씨 요약", () => {
  const item = (fcstDate: string, category: string, fcstValue: string, fcstTime = "1200") => ({
    category,
    fcstDate,
    fcstTime,
    fcstValue,
  });

  test("a day with 최저·최고기온 takes their middle", () => {
    const items = [item("20261110", "TMN", "4"), item("20261110", "TMX", "12"), item("20261110", "TMP", "9")];
    expect(dayWeather(items, "20261110", "20261108")).toEqual({ temperature: 8, rain: false });
  });

  test("a later day with only a few hourly 기온 and no 최저·최고기온 has no forecast", () => {
    const items = [item("20261113", "TMP", "10", "0000"), item("20261113", "PTY", "0", "0000")];
    expect(dayWeather(items, "20261113", "20261108")).toBeNull();
  });

  test("today, whose 최저·최고기온 may be left out of later issues, takes the hourly 기온 left", () => {
    const items = [item("20261108", "TMP", "6", "1800"), item("20261108", "TMP", "4", "2100")];
    expect(dayWeather(items, "20261108", "20261108")).toEqual({ temperature: 5, rain: false });
  });

  test("a day with any 강수형태 is rainy", () => {
    const items = [item("20261110", "TMN", "4"), item("20261110", "TMX", "12"), item("20261110", "PTY", "1")];
    expect(dayWeather(items, "20261110", "20261108")).toEqual({ temperature: 8, rain: true });
  });
});
