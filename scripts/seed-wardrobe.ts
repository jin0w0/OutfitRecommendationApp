// Fills a signed-up user's 옷장 with sample clothes for development and demos.
// Run with: npm run db:seed -- <email of the 로그인 계정>
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { createWardrobe, type NewClothing } from "../lib/outfit/wardrobe.ts";

const email = process.argv[2];
if (!email) throw new Error("Usage: npm run db:seed -- <email>");

const ALL_YEAR: NewClothing["seasons"] = ["spring", "summer", "autumn", "winter"];

const CLOTHES: NewClothing[] = [
  { name: "흰 티셔츠", slot: "top", color: "white", seasons: ALL_YEAR, style: "casual", formality: "casual", warmth: 1 },
  { name: "회색 맨투맨", slot: "top", color: "gray", seasons: ["spring", "autumn", "winter"], style: "casual", formality: "casual", warmth: 2 },
  { name: "그래픽 반팔티", slot: "top", color: "black", seasons: ["summer"], style: "street", formality: "casual", warmth: 1 },
  { name: "기능성 운동복 상의", slot: "top", color: "blue", seasons: ALL_YEAR, style: "sporty", formality: "casual", warmth: 1 },
  { name: "네이비 니트", slot: "top", color: "navy", seasons: ["autumn", "winter"], style: "minimal", formality: "semi-formal", warmth: 3 },
  { name: "하늘색 옥스퍼드 셔츠", slot: "top", color: "blue", seasons: ALL_YEAR, style: "classic", formality: "semi-formal", warmth: 2 },
  { name: "흰 드레스 셔츠", slot: "top", color: "white", seasons: ALL_YEAR, style: "classic", formality: "formal", warmth: 2 },
  { name: "연청 청바지", slot: "bottom", color: "blue", seasons: ALL_YEAR, style: "casual", formality: "casual", warmth: 2 },
  { name: "검정 조거팬츠", slot: "bottom", color: "black", seasons: ALL_YEAR, style: "sporty", formality: "casual", warmth: 2 },
  { name: "베이지 치노 팬츠", slot: "bottom", color: "beige", seasons: ALL_YEAR, style: "minimal", formality: "semi-formal", warmth: 2 },
  { name: "회색 슬랙스", slot: "bottom", color: "gray", seasons: ALL_YEAR, style: "classic", formality: "semi-formal", warmth: 2 },
  { name: "검정 정장 바지", slot: "bottom", color: "black", seasons: ALL_YEAR, style: "classic", formality: "formal", warmth: 2 },
  { name: "검정 원피스", slot: "dress", color: "black", seasons: ALL_YEAR, style: "classic", formality: "formal", warmth: 2 },
  { name: "꽃무늬 원피스", slot: "dress", color: "pink", seasons: ["spring", "summer"], style: "casual", formality: "casual", warmth: 1 },
  { name: "흰 운동화", slot: "shoes", color: "white", seasons: ALL_YEAR, style: "casual", formality: "casual", warmth: 2 },
  { name: "러닝화", slot: "shoes", color: "gray", seasons: ALL_YEAR, style: "sporty", formality: "casual", warmth: 2 },
  { name: "갈색 로퍼", slot: "shoes", color: "brown", seasons: ALL_YEAR, style: "classic", formality: "semi-formal", warmth: 2 },
  { name: "검정 구두", slot: "shoes", color: "black", seasons: ALL_YEAR, style: "classic", formality: "formal", warmth: 2 },
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const dialect = new PostgresDialect({ pool });
const db = new Kysely<{ user: { id: string; email: string } }>({ dialect });
const wardrobe = createWardrobe({ dialect });

try {
  const user = await db.selectFrom("user").select("id").where("email", "=", email).executeTakeFirst();
  if (!user) throw new Error(`No user signed up as ${email}. Sign in to the app first.`);

  if ((await wardrobe.clothes(user.id)).length > 0) {
    console.log(`${email} already has clothes; leaving the 옷장 as it is.`);
  } else {
    for (const clothing of CLOTHES) await wardrobe.addClothing(user.id, clothing);
    await wardrobe.setPreferences(user.id, { colors: ["navy", "white"], styles: ["minimal"] });
    console.log(`Added ${CLOTHES.length} clothes to ${email}'s 옷장.`);
  }
} finally {
  await pool.end();
}
