import type { Clothing } from "@/lib/outfit/wardrobe";

// A piece's photo through the owner-only route, or a plain tile for clothes
// registered before photos (seed data).
export function ClothingPhoto({
  clothing,
  className = "",
}: {
  clothing: Pick<Clothing, "id" | "hasPhoto">;
  className?: string;
}) {
  if (!clothing.hasPhoto) {
    return <div className={`rounded-lg bg-zinc-100 dark:bg-zinc-900 ${className}`} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a short-lived private URL behind a redirect
    <img src={`/api/clothing/${clothing.id}/photo`} alt="" className={`rounded-lg object-cover ${className}`} />
  );
}
