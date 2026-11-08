import "server-only";
import { PostgresDialect } from "kysely";
import { Pool } from "pg";
import { createOutfitRecommender, type OutfitRecommender } from "./recommender";
import { createWardrobe } from "./wardrobe";
import { createWearRecords } from "./wear-records";

let instance: OutfitRecommender | undefined;

// The app's single 코디 추천 module, over the 옷장 and 착용 기록 in Neon. Built on first use
// so that `next build` does not need the secrets.
export function getOutfitRecommender(): OutfitRecommender {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing environment variable DATABASE_URL");
  if (!instance) {
    const dialect = new PostgresDialect({ pool: new Pool({ connectionString }) });
    instance = createOutfitRecommender({
      wardrobe: createWardrobe({ dialect }),
      wearRecords: createWearRecords({ dialect }),
    });
  }
  return instance;
}
