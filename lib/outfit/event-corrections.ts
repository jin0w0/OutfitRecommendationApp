// 일정 판단 수정값: the 일정의 종류 and 격식 수준 a user set for one of their
// calendar 일정, overriding what the LLM judged. Kept per user and calendar
// 일정 식별자 in Postgres, and removed with the user on 탈퇴.
import { Kysely, type Dialect } from "kysely";
import type { EventKind } from "./situations";
import type { Formality } from "./wardrobe";

export type EventCorrection = { kind: EventKind; formality: Formality };

type Tables = {
  event_correction: {
    user_id: string;
    event_id: string;
    kind: EventKind;
    formality: Formality;
  };
};

export function createEventCorrections({ dialect }: { dialect: Dialect }) {
  const db = new Kysely<Tables>({ dialect });

  return {
    async migrate() {
      await db.schema
        .createTable("event_correction")
        .ifNotExists()
        .addColumn("user_id", "text", (c) =>
          c.notNull().references("user.id").onDelete("cascade"),
        )
        .addColumn("event_id", "text", (c) => c.notNull())
        .addColumn("kind", "text", (c) => c.notNull())
        .addColumn("formality", "text", (c) => c.notNull())
        .addPrimaryKeyConstraint("event_correction_pkey", ["user_id", "event_id"])
        .execute();
    },

    // Correcting the same 일정 again replaces the earlier correction.
    async save(userId: string, eventId: string, { kind, formality }: EventCorrection) {
      await db
        .insertInto("event_correction")
        .values({ user_id: userId, event_id: eventId, kind, formality })
        .onConflict((oc) => oc.columns(["user_id", "event_id"]).doUpdateSet({ kind, formality }))
        .execute();
    },

    // Every correction the user made.
    async forgetAll(userId: string) {
      await db.deleteFrom("event_correction").where("user_id", "=", userId).execute();
    },

    // The user's corrections among these 일정, by 일정 식별자.
    async forEvents(userId: string, eventIds: string[]): Promise<Map<string, EventCorrection>> {
      if (!eventIds.length) return new Map();
      const rows = await db
        .selectFrom("event_correction")
        .select(["event_id", "kind", "formality"])
        .where("user_id", "=", userId)
        .where("event_id", "in", eventIds)
        .execute();
      return new Map(rows.map(({ event_id, kind, formality }) => [event_id, { kind, formality }]));
    },
  };
}

export type EventCorrections = ReturnType<typeof createEventCorrections>;
