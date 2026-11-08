import { describe, expect, test } from "vitest";
import { toKmaGrid } from "./kma-weather";

describe("기상청 격자 좌표", () => {
  test("Seoul's 위경도 is grid 60, 127", () => {
    expect(toKmaGrid({ latitude: 37.5665, longitude: 126.978 })).toEqual({ nx: 60, ny: 127 });
  });

  test("Busan's 위경도 is grid 98, 76", () => {
    expect(toKmaGrid({ latitude: 35.1796, longitude: 129.0756 })).toEqual({ nx: 98, ny: 76 });
  });
});
