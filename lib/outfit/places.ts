// 장소 문자열 → 예보 지점. A calendar 장소 is free text ("부산광역시 해운대구 …",
// "강남역", "Seoul"), so it is matched against the names of Korea's 17 시·도 and
// their larger cities, and the weather is looked up at that 시·도's seat — the
// same points a 기본 지역 uses. No geocoding service: it needs no key or network,
// and 시·도 is as fine as the day's weather needs to be. A 장소 that names no
// known place resolves to null, and the 기본 지역 is used instead.
import { REGIONS, type Region } from "@/lib/account/regions";

// Names that point at each 시·도, besides its short name ("부산").
const ALIASES: Record<string, string[]> = {
  seoul: ["서울특별시", "Seoul"],
  busan: ["부산광역시", "Busan", "해운대"],
  daegu: ["대구광역시", "Daegu"],
  incheon: ["인천광역시", "Incheon", "송도"],
  gwangju: ["광주광역시", "Gwangju"],
  daejeon: ["대전광역시", "Daejeon"],
  ulsan: ["울산광역시", "Ulsan"],
  sejong: ["세종특별자치시", "Sejong"],
  gyeonggi: [
    "경기도",
    "Gyeonggi",
    "수원",
    "성남",
    "분당",
    "판교",
    "고양",
    "일산",
    "용인",
    "부천",
    "안양",
    "화성",
    "평택",
    "파주",
    "김포",
    "의정부",
    "남양주",
  ],
  gangwon: ["강원도", "강원특별자치도", "Gangwon", "춘천", "강릉", "원주", "속초", "평창"],
  chungbuk: ["충청북도", "청주", "충주"],
  chungnam: ["충청남도", "천안", "아산"],
  jeonbuk: ["전라북도", "전북특별자치도", "전주", "군산"],
  jeonnam: ["전라남도", "여수", "순천", "목포"],
  gyeongbuk: ["경상북도", "포항", "경주", "안동", "구미"],
  gyeongnam: ["경상남도", "창원", "김해", "진주", "통영", "거제"],
  jeju: ["제주특별자치도", "Jeju", "서귀포"],
};

// Short names too common inside other words to count alone ("월드컵경기장").
const AMBIGUOUS = new Set(["경기"]);

const NAMES: { name: string; region: Region }[] = REGIONS.flatMap((region) =>
  [region.name, ...(ALIASES[region.id] ?? [])]
    .filter((name) => !AMBIGUOUS.has(name))
    .map((name) => ({ name, region })),
);

// The 시·도 a 장소 is in, or null when it names none. Addresses go from the
// largest area down, so the name that appears first wins ("경기도 광주시" is 경기,
// not 광주광역시).
export function regionOfPlace(place: string): Region | null {
  const text = place.toLowerCase();
  let best: { index: number; region: Region } | null = null;
  for (const { name, region } of NAMES) {
    const index = text.indexOf(name.toLowerCase());
    if (index !== -1 && (!best || index < best.index)) best = { index, region };
  }
  return best?.region ?? null;
}
