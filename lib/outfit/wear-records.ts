// 착용 기록 and plans: the 코디 a user accepted for a date, in Postgres next to
// the 옷장. A date on or before today is 착용 기록 ("worn"); a later one is a
// plan that is never counted as worn.
import { Kysely, type Dialect, type JSONColumnType } from "kysely";

export type WearStatus = "worn" | "planned";

export type WearRecord = { date: string; status: WearStatus; clothingIds: string[] };

type Tables = {
  wear_record: {
    user_id: string;
    // YYYY-MM-DD
    date: string;
    status: WearStatus;
    clothing_ids: JSONColumnType<string[]>;
  };
};

export function createWearRecords({ dialect }: { dialect: Dialect }) {
  const db = new Kysely<Tables>({ dialect });

  return {
    async migrate() {
      await db.schema
        .createTable("wear_record")
        .ifNotExists()
        .addColumn("user_id", "text", (c) =>
          c.notNull().references("user.id").onDelete("cascade"),
        )
        .addColumn("date", "text", (c) => c.notNull())
        .addColumn("status", "text", (c) => c.notNull())
        .addColumn("clothing_ids", "jsonb", (c) => c.notNull())
        .addPrimaryKeyConstraint("wear_record_pkey", ["user_id", "date"])
        .execute();
    },

    // One accepted 코디 per user and date; accepting again replaces it.
    async save(userId: string, { date, status, clothingIds }: WearRecord) {
      const values = { status, clothing_ids: JSON.stringify(clothingIds) };
      await db
        .insertInto("wear_record")
        .values({ user_id: userId, date, ...values })
        .onConflict((oc) => oc.columns(["user_id", "date"]).doUpdateSet(values))
        .execute();
    },

    async remove(userId: string, date: string) {
      await db
        .deleteFrom("wear_record")
        .where("user_id", "=", userId)
        .where("date", "=", date)
        .execute();
    },

    async onDate(userId: string, date: string): Promise<WearRecord | undefined> {
      const row = await db
        .selectFrom("wear_record")
        .select(["date", "status", "clothing_ids"])
        .where("user_id", "=", userId)
        .where("date", "=", date)
        .executeTakeFirst();
      return row && { date: row.date, status: row.status, clothingIds: row.clothing_ids };
    },

    // 착용 기록 (never plans) before `date`, newest first.
    async wornBefore(userId: string, date: string): Promise<WearRecord[]> {
      const rows = await db
        .selectFrom("wear_record")
        .select(["date", "status", "clothing_ids"])
        .where("user_id", "=", userId)
        .where("status", "=", "worn")
        .where("date", "<", date)
        .orderBy("date", "desc")
        .execute();
      return rows.map((row) => ({ date: row.date, status: row.status, clothingIds: row.clothing_ids }));
    },
  };
}

export type WearRecords = ReturnType<typeof createWearRecords>;
