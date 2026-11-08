import { createTestAccount } from "@/lib/account/testing/harness";
import { createOutfitRecommender } from "../recommender";
import { createWardrobe, type NewClothing } from "../wardrobe";

// A recommender over a real 옷장 in an in-process Postgres, next to the
// account tables so clothes belong to real users.
export async function createTestOutfit() {
  const { account, google, dialect, signInWithGoogle } = await createTestAccount();
  await account.migrate();
  const wardrobe = createWardrobe({ dialect });
  await wardrobe.migrate();
  const recommender = createOutfitRecommender({ wardrobe });

  async function createUser(email: string) {
    google.addAccount({ email, name: email });
    const { headers } = await signInWithGoogle(email);
    const user = await account.getCurrentUser(headers);
    return user!.id;
  }

  // Adds clothes to a user's 옷장, filling in unremarkable defaults.
  async function addClothes(userId: string, clothes: (Partial<NewClothing> & Pick<NewClothing, "name" | "slot">)[]) {
    const added = [];
    for (const clothing of clothes) {
      added.push(
        await wardrobe.addClothing(userId, {
          color: "black",
          seasons: ["spring", "summer", "autumn", "winter"],
          style: "casual",
          formality: "casual",
          warmth: 2,
          ...clothing,
        }),
      );
    }
    return added;
  }

  return { wardrobe, recommender, createUser, addClothes };
}
