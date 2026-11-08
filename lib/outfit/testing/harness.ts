import { createTestAccount } from "@/lib/account/testing/harness";
import { createOutfitRecommender } from "../recommender";
import { createWardrobe, type NewClothing } from "../wardrobe";
import { createWearRecords } from "../wear-records";

// A recommender over a real 옷장 in an in-process Postgres, next to the
// account tables so clothes belong to real users.
// `today` is the date the recommender takes as today (YYYY-MM-DD).
export async function createTestOutfit({ today = "2026-11-10" }: { today?: string } = {}) {
  const { account, google, dialect, signInWithGoogle } = await createTestAccount();
  await account.migrate();
  const wardrobe = createWardrobe({ dialect });
  await wardrobe.migrate();
  const wearRecords = createWearRecords({ dialect });
  await wearRecords.migrate();
  const recommender = createOutfitRecommender({ wardrobe, wearRecords, today: () => today });

  const signedIn = new Map<string, Headers>();

  async function createUser(email: string) {
    google.addAccount({ email, name: email });
    const { headers } = await signInWithGoogle(email);
    const user = await account.getCurrentUser(headers);
    signedIn.set(user!.id, headers);
    return user!.id;
  }

  // 탈퇴 for a user made with createUser.
  async function deleteAccount(userId: string) {
    await account.deleteAccount(signedIn.get(userId)!);
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

  return { wardrobe, recommender, createUser, deleteAccount, addClothes };
}
