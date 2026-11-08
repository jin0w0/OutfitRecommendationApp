// The real 날씨 어댑터: 기상청 API허브's 단기예보 (VilageFcstInfoService_2.0/
// getVilageFcst). Not tested automatically; check it by hand with a real key.
import type { Coordinates, Weather, WeatherSource } from "./recommender";

const ENDPOINT =
  "https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst";

// 단기예보 is issued at these hours (KST) and can be fetched from 10 minutes past.
const BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23];
const AVAILABLE_AFTER_MINUTES = 10;

// A day of rain is one with any 강수형태 or at least this 강수확률 (%).
const RAINY_POP = 60;

type ForecastItem = {
  category: string;
  fcstDate: string;
  fcstTime: string;
  fcstValue: string;
};

type ForecastResponse = {
  response: {
    header: { resultCode: string; resultMsg: string };
    body?: { items: { item: ForecastItem[] } };
  };
};

export function createKmaWeather({
  authKey,
  now = () => new Date(),
}: {
  authKey: string;
  now?: () => Date;
}): WeatherSource {
  return {
    async forecast({ date, ...location }) {
      const { nx, ny } = toKmaGrid(location);
      const { baseDate, baseTime } = latestBase(now());
      const params = new URLSearchParams({
        pageNo: "1",
        // About four days of hourly items: all the 단기예보 one issue has.
        numOfRows: "1500",
        dataType: "JSON",
        base_date: baseDate,
        base_time: baseTime,
        nx: String(nx),
        ny: String(ny),
        authKey,
      });
      const response = await fetch(`${ENDPOINT}?${params}`);
      if (!response.ok) throw new Error(`기상청 단기예보 failed: HTTP ${response.status}`);
      const { response: body } = (await response.json()) as ForecastResponse;
      // 03 is NO_DATA.
      if (body.header.resultCode === "03") return null;
      if (body.header.resultCode !== "00") {
        throw new Error(`기상청 단기예보 failed: ${body.header.resultCode} ${body.header.resultMsg}`);
      }
      return dayWeather(body.body?.items.item ?? [], date.replaceAll("-", ""));
    },
  };
}

// The day's 기온 and 강수 여부 from its forecast items, or null when the issue
// does not reach that date (단기예보 범위 밖).
function dayWeather(items: ForecastItem[], fcstDate: string): Weather | null {
  const day = items.filter((item) => item.fcstDate === fcstDate);
  if (!day.length) return null;
  const values = (category: string) =>
    day.filter((item) => item.category === category).map((item) => Number(item.fcstValue));

  const [min] = values("TMN");
  const [max] = values("TMX");
  const hourly = values("TMP");
  let temperature: number;
  if (min !== undefined && max !== undefined) temperature = (min + max) / 2;
  else if (hourly.length) temperature = hourly.reduce((sum, t) => sum + t, 0) / hourly.length;
  else return null;

  // PTY 0 is 없음; POP is a percentage.
  const rain =
    values("PTY").some((type) => type !== 0) || values("POP").some((pop) => pop >= RAINY_POP);
  return { temperature: Math.round(temperature * 10) / 10, rain };
}

// The most recent 단기예보 issue that can be fetched at `now`, in KST.
function latestBase(now: Date) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const hour = BASE_HOURS.findLast((h) => h * 60 + AVAILABLE_AFTER_MINUTES <= minutes);
  if (hour === undefined) {
    // Before 02:10 the latest is yesterday's 23:00 issue.
    kst.setUTCDate(kst.getUTCDate() - 1);
  }
  const baseDate = kst.toISOString().slice(0, 10).replaceAll("-", "");
  const baseTime = `${String(hour ?? 23).padStart(2, "0")}00`;
  return { baseDate, baseTime };
}

// 위경도 → 기상청 격자 (nx, ny): the Lambert conformal conic projection from the
// 기상청's 단기예보 guide (grid 5km, standard parallels 30°N and 60°N, origin
// 38°N 126°E at grid 43, 136).
export function toKmaGrid({ latitude, longitude }: Coordinates) {
  const RE = 6371.00877 / 5.0;
  const DEGRAD = Math.PI / 180;
  const slat1 = 30 * DEGRAD;
  const slat2 = 60 * DEGRAD;
  const olon = 126 * DEGRAD;
  const olat = 38 * DEGRAD;
  const XO = 43;
  const YO = 136;

  const sn =
    Math.log(Math.cos(slat1) / Math.cos(slat2)) /
    Math.log(Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5));
  const sf = (Math.pow(Math.tan(Math.PI * 0.25 + slat1 * 0.5), sn) * Math.cos(slat1)) / sn;
  const ro = (RE * sf) / Math.pow(Math.tan(Math.PI * 0.25 + olat * 0.5), sn);

  const ra = (RE * sf) / Math.pow(Math.tan(Math.PI * 0.25 + latitude * DEGRAD * 0.5), sn);
  let theta = longitude * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}
