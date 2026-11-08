import "server-only";
import { PostgresDialect } from "kysely";
import { Pool } from "pg";
import { createKmaWeather } from "./kma-weather";
import { createOutfitRecommender, type OutfitRecommender, type WeatherSource } from "./recommender";
import { createWardrobe } from "./wardrobe";
import { createWearRecords } from "./wear-records";

let instance: OutfitRecommender | undefined;

// The app's single 코디 추천 module, over the 옷장 and 착용 기록 in Neon and the 기상청
// 단기예보. Built on first use so that `next build` does not need the secrets.
export function getOutfitRecommender(): OutfitRecommender {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing environment variable DATABASE_URL");
  if (!instance) {
    const dialect = new PostgresDialect({ pool: new Pool({ connectionString }) });
    instance = createOutfitRecommender({
      wardrobe: createWardrobe({ dialect }),
      weather: weatherSource(),
      wearRecords: createWearRecords({ dialect }),
    });
  }
  return instance;
}

// Without a key every forecast fails, so recommendations go on without weather
// and say so, rather than the page breaking.
function weatherSource(): WeatherSource {
  const authKey = process.env.KMA_AUTH_KEY;
  if (authKey) return createKmaWeather({ authKey });
  return {
    async forecast() {
      throw new Error("Missing environment variable KMA_AUTH_KEY");
    },
  };
}
