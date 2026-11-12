// The 옷장 store: every user's clothes and their color/style preferences, in
// Postgres next to the account tables.
import { randomUUID } from "node:crypto";
import { Kysely, sql, type Dialect, type Generated, type JSONColumnType } from "kysely";

export type Slot = "top" | "bottom" | "dress" | "outer" | "shoes";
export type Season = "spring" | "summer" | "autumn" | "winter";
export type Formality = "casual" | "semi-formal" | "formal";
export type Style = "casual" | "minimal" | "classic" | "street" | "sporty";
export type Material =
  | "cotton"
  | "linen"
  | "denim"
  | "wool"
  | "knit"
  | "leather"
  | "suede"
  | "canvas"
  | "synthetic";

// Every value each field can take, for checking what comes from outside.
export const SLOTS: readonly Slot[] = ["top", "bottom", "dress", "outer", "shoes"];
export const SEASONS: readonly Season[] = ["spring", "summer", "autumn", "winter"];
export const STYLES: readonly Style[] = ["casual", "minimal", "classic", "street", "sporty"];
export const FORMALITIES: readonly Formality[] = ["casual", "semi-formal", "formal"];
export const WARMTHS: readonly ClothingFields["warmth"][] = [1, 2, 3];
export const MATERIALS: readonly Material[] = [
  "cotton",
  "linen",
  "denim",
  "wool",
  "knit",
  "leather",
  "suede",
  "canvas",
  "synthetic",
];

// The 15 colors a piece can be. A piece with several colors (checks,
// stripes) takes the one that covers most of it.
export const COLORS = [
  "black",
  "white",
  "gray",
  "navy",
  "beige",
  "brown",
  "red",
  "pink",
  "orange",
  "yellow",
  "green",
  "khaki",
  "skyblue",
  "blue",
  "purple",
] as const;
export type Color = (typeof COLORS)[number];

// 추정 착용 빈도: how often the user said they wear a piece when registering it.
export const ESTIMATED_WEAR_FREQUENCIES = ["weekly", "monthly", "rarely", "new"] as const;
export type EstimatedWearFrequency = (typeof ESTIMATED_WEAR_FREQUENCIES)[number];

// How many days ago a piece with no 착용 기록 is taken to have been worn, by
// its 추정 착용 빈도. A new piece counts as never worn (null). The 추천
// scores by it; the 옷장 분석 decides 안 입는 옷 by it.
export const ASSUMED_DAYS_SINCE_WORN: Record<EstimatedWearFrequency, number | null> = {
  weekly: 3,
  monthly: 15,
  rarely: 60,
  new: null,
};

// What describes a piece, as the user confirms it when registering.
export type ClothingFields = {
  name: string;
  slot: Slot;
  color: Color;
  seasons: Season[];
  style: Style;
  formality: Formality;
  // 두께: 1 thin, 2 regular, 3 thick.
  warmth: 1 | 2 | 3;
  material: Material;
};

export type Clothing = { id: string } & ClothingFields & {
  // Whether there is a photo to show (clothes from before 옷 등록 have none).
  hasPhoto: boolean;
  // What the user said when registering it; null for clothes from before.
  estimatedWearFrequency: EstimatedWearFrequency | null;
};

export type NewClothing = ClothingFields;

// What 옷 등록 adds beyond the fields.
export type Registration = {
  photoKey?: string;
  estimatedWearFrequency?: EstimatedWearFrequency;
  // When it was registered; now unless given (tests and imports set it).
  registeredAt?: Date;
};

export type Preferences = { colors: Color[]; styles: Style[] };

// The user's 성별, which new pieces are suggested for. Null until the user
// chooses, which filters nothing.
export const GENDERS = ["male", "female"] as const;
export type Gender = (typeof GENDERS)[number];

// Whether a new piece of `slot` may be suggested for the 성별: never a 원피스
// for a man. Owned clothes are never filtered.
export function suitsGender(slot: Slot, gender: Gender | null) {
  return gender !== "male" || slot !== "dress";
}

type Tables = {
  clothing: {
    id: string;
    user_id: string;
    name: string;
    slot: Slot;
    color: Color;
    seasons: JSONColumnType<Season[]>;
    style: Style;
    formality: Formality;
    warmth: 1 | 2 | 3;
    material: Generated<Material>;
    photo_key: string | null;
    estimated_wear_frequency: EstimatedWearFrequency | null;
    // When the piece was 정리; null while it is in the 옷장.
    tidied_at: Date | null;
    created_at: Generated<Date>;
    // Counts up as clothes are added, so it orders them even when several
    // share a created_at.
    seq: Generated<string>;
  };
  clothing_preference: {
    user_id: string;
    colors: JSONColumnType<Color[]>;
    styles: JSONColumnType<Style[]>;
    gender: Generated<Gender | null>;
  };
};

export function createWardrobe({ dialect }: { dialect: Dialect }) {
  const db = new Kysely<Tables>({ dialect });

  async function select(userId: string, which: "in-wardrobe" | "tidied" | "all"): Promise<Clothing[]> {
    let query = db
      .selectFrom("clothing")
      .select([
        "id",
        "name",
        "slot",
        "color",
        "seasons",
        "style",
        "formality",
        "warmth",
        "material",
        "photo_key",
        "estimated_wear_frequency",
      ])
      .where("user_id", "=", userId);
    if (which === "in-wardrobe") query = query.where("tidied_at", "is", null);
    if (which === "tidied") query = query.where("tidied_at", "is not", null);
    // In the order they were added, so that ties in the score go to the
    // same clothes every time.
    const rows = await query.orderBy("seq").execute();
    return rows.map(({ photo_key, estimated_wear_frequency, ...clothing }) => ({
      ...clothing,
      hasPhoto: photo_key !== null,
      estimatedWearFrequency: estimated_wear_frequency,
    }));
  }

  return {
    async migrate() {
      await db.schema
        .createTable("clothing")
        .ifNotExists()
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("user_id", "text", (c) =>
          c.notNull().references("user.id").onDelete("cascade"),
        )
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("slot", "text", (c) => c.notNull())
        .addColumn("color", "text", (c) => c.notNull())
        .addColumn("seasons", "jsonb", (c) => c.notNull())
        .addColumn("style", "text", (c) => c.notNull())
        .addColumn("formality", "text", (c) => c.notNull())
        .addColumn("warmth", "integer", (c) => c.notNull())
        .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
        .execute();
      // Added after the table first shipped, so tables made before it get it too.
      await sql`alter table clothing add column if not exists material text not null default 'cotton'`.execute(
        db,
      );
      // Also added later. Rows already there are numbered in their table order.
      await sql`alter table clothing add column if not exists seq bigint generated by default as identity`.execute(
        db,
      );
      // Added with 옷 등록; clothes from before it have neither.
      await sql`alter table clothing add column if not exists photo_key text`.execute(db);
      await sql`alter table clothing add column if not exists estimated_wear_frequency text`.execute(db);
      await sql`alter table clothing add column if not exists tidied_at timestamptz`.execute(db);
      await db.schema
        .createTable("clothing_preference")
        .ifNotExists()
        .addColumn("user_id", "text", (c) =>
          c.primaryKey().references("user.id").onDelete("cascade"),
        )
        .addColumn("colors", "jsonb", (c) => c.notNull())
        .addColumn("styles", "jsonb", (c) => c.notNull())
        .execute();
      // Added with 성별.
      await sql`alter table clothing_preference add column if not exists gender text`.execute(db);
    },

    async addClothing(userId: string, clothing: NewClothing, registration?: Registration): Promise<Clothing> {
      const id = randomUUID();
      await db
        .insertInto("clothing")
        .values({
          id,
          user_id: userId,
          ...clothing,
          seasons: JSON.stringify(clothing.seasons),
          photo_key: registration?.photoKey ?? null,
          estimated_wear_frequency: registration?.estimatedWearFrequency ?? null,
          ...(registration?.registeredAt && { created_at: registration.registeredAt }),
        })
        .execute();
      return {
        id,
        ...clothing,
        hasPhoto: registration?.photoKey !== undefined,
        estimatedWearFrequency: registration?.estimatedWearFrequency ?? null,
      };
    },

    // Replaces a piece's fields and 추정 착용 빈도. False if it is not the user's.
    async updateClothing(
      userId: string,
      clothingId: string,
      clothing: NewClothing,
      estimatedWearFrequency: EstimatedWearFrequency,
    ): Promise<boolean> {
      const result = await db
        .updateTable("clothing")
        .set({ ...clothing, seasons: JSON.stringify(clothing.seasons), estimated_wear_frequency: estimatedWearFrequency })
        .where("user_id", "=", userId)
        .where("id", "=", clothingId)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) > 0;
    },

    // Points a piece at another photo. False if it is not the user's.
    async setPhotoKey(userId: string, clothingId: string, photoKey: string): Promise<boolean> {
      const result = await db
        .updateTable("clothing")
        .set({ photo_key: photoKey })
        .where("user_id", "=", userId)
        .where("id", "=", clothingId)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) > 0;
    },

    // When each of the user's clothes was registered, by clothing id.
    async registeredAt(userId: string): Promise<Map<string, Date>> {
      const rows = await db
        .selectFrom("clothing")
        .select(["id", "created_at"])
        .where("user_id", "=", userId)
        .execute();
      return new Map(rows.map((row) => [row.id, row.created_at]));
    },

    // Whether one of the user's clothes already has this photo.
    async photoInUse(userId: string, photoKey: string): Promise<boolean> {
      const row = await db
        .selectFrom("clothing")
        .select("id")
        .where("user_id", "=", userId)
        .where("photo_key", "=", photoKey)
        .executeTakeFirst();
      return row !== undefined;
    },

    // Where a piece's photo is kept, if it is the user's and has one.
    async photoKey(userId: string, clothingId: string): Promise<string | null> {
      const row = await db
        .selectFrom("clothing")
        .select("photo_key")
        .where("user_id", "=", userId)
        .where("id", "=", clothingId)
        .executeTakeFirst();
      return row?.photo_key ?? null;
    },

    // The 옷장: the user's clothes not 정리.
    clothes: (userId: string) => select(userId, "in-wardrobe"),

    // 정리한 옷.
    tidiedClothes: (userId: string) => select(userId, "tidied"),

    // Both, for showing what was worn or recommended before some were 정리.
    clothesIncludingTidied: (userId: string) => select(userId, "all"),

    // 정리하기 (`tidied` true) or 되돌리기. False if it is not the user's.
    async setTidied(userId: string, clothingId: string, tidied: boolean): Promise<boolean> {
      const result = await db
        .updateTable("clothing")
        .set({ tidied_at: tidied ? new Date() : null })
        .where("user_id", "=", userId)
        .where("id", "=", clothingId)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) > 0;
    },

    async setPreferences(userId: string, { colors, styles }: Preferences) {
      const values = { colors: JSON.stringify(colors), styles: JSON.stringify(styles) };
      await db
        .insertInto("clothing_preference")
        .values({ user_id: userId, ...values })
        .onConflict((oc) => oc.column("user_id").doUpdateSet(values))
        .execute();
    },

    async preferences(userId: string): Promise<Preferences> {
      const row = await db
        .selectFrom("clothing_preference")
        .select(["colors", "styles"])
        .where("user_id", "=", userId)
        .executeTakeFirst();
      return row ?? { colors: [], styles: [] };
    },

    async setGender(userId: string, gender: Gender) {
      await db
        .insertInto("clothing_preference")
        .values({ user_id: userId, colors: JSON.stringify([]), styles: JSON.stringify([]), gender: gender })
        .onConflict((oc) => oc.column("user_id").doUpdateSet({ gender: gender }))
        .execute();
    },

    async gender(userId: string): Promise<Gender | null> {
      const row = await db
        .selectFrom("clothing_preference")
        .select("gender")
        .where("user_id", "=", userId)
        .executeTakeFirst();
      return row?.gender ?? null;
    },
  };
}

export type Wardrobe = ReturnType<typeof createWardrobe>;
