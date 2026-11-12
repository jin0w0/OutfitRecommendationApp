// What 이 한 벌 제안 keeps: the LLM's candidates for each target with the 옷장
// fingerprint they were made for, and the suggestions the user is not
// interested in. Removed with the user. No app imports, so scripts load it
// with plain Node.
import { Kysely, type Dialect, type JSONColumnType } from "kysely";

type Tables = {
  piece_candidates: {
    user_id: string;
    target: string;
    fingerprint: string;
    candidates: JSONColumnType<unknown[]>;
  };
  dismissed_piece: { user_id: string; suggestion_id: string; until: string };
};

export function createPieceStore({ dialect }: { dialect: Dialect }) {
  const db = new Kysely<Tables>({ dialect });

  return {
    async migrate() {
      await db.schema
        .createTable("piece_candidates")
        .ifNotExists()
        .addColumn("user_id", "text", (c) => c.notNull().references("user.id").onDelete("cascade"))
        .addColumn("target", "text", (c) => c.notNull())
        .addColumn("fingerprint", "text", (c) => c.notNull())
        .addColumn("candidates", "jsonb", (c) => c.notNull())
        .addPrimaryKeyConstraint("piece_candidates_pkey", ["user_id", "target"])
        .execute();
      await db.schema
        .createTable("dismissed_piece")
        .ifNotExists()
        .addColumn("user_id", "text", (c) => c.notNull().references("user.id").onDelete("cascade"))
        .addColumn("suggestion_id", "text", (c) => c.notNull())
        .addColumn("until", "text", (c) => c.notNull())
        .addPrimaryKeyConstraint("dismissed_piece_pkey", ["user_id", "suggestion_id"])
        .execute();
    },

    // The candidates saved for `target`, if they were made for this fingerprint.
    async candidates(userId: string, target: string, fingerprint: string): Promise<unknown[] | null> {
      const row = await db
        .selectFrom("piece_candidates")
        .select(["fingerprint", "candidates"])
        .where("user_id", "=", userId)
        .where("target", "=", target)
        .executeTakeFirst();
      return row && row.fingerprint === fingerprint ? row.candidates : null;
    },

    async saveCandidates(userId: string, target: string, fingerprint: string, candidates: unknown[]) {
      const values = { fingerprint, candidates: JSON.stringify(candidates) };
      await db
        .insertInto("piece_candidates")
        .values({ user_id: userId, target, ...values })
        .onConflict((oc) => oc.columns(["user_id", "target"]).doUpdateSet(values))
        .execute();
    },

    async dismiss(userId: string, suggestionId: string, until: string) {
      await db
        .insertInto("dismissed_piece")
        .values({ user_id: userId, suggestion_id: suggestionId, until })
        .onConflict((oc) => oc.columns(["user_id", "suggestion_id"]).doUpdateSet({ until }))
        .execute();
    },

    // Suggestion ids the user is not interested in, still hidden on `date`.
    async dismissedOn(userId: string, date: string): Promise<Set<string>> {
      const rows = await db
        .selectFrom("dismissed_piece")
        .select("suggestion_id")
        .where("user_id", "=", userId)
        .where("until", ">", date)
        .execute();
      return new Set(rows.map((row) => row.suggestion_id));
    },
  };
}

export type PieceStore = ReturnType<typeof createPieceStore>;
