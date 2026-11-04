import { REGIONS, type Region } from "@/lib/account/regions";
import { saveHomeRegion } from "./actions";

export function RegionForm({
  current,
  next,
  submitLabel,
}: {
  current: Region | null;
  next: "/home" | "/settings";
  submitLabel: string;
}) {
  return (
    <form action={saveHomeRegion} className="flex items-center gap-3">
      <input type="hidden" name="next" value={next} />
      <select
        name="region"
        defaultValue={current?.id ?? "seoul"}
        aria-label="기본 지역"
        className="h-10 rounded-md border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
      >
        {REGIONS.map((region) => (
          <option key={region.id} value={region.id}>
            {region.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="h-10 rounded-full bg-foreground px-5 text-background"
      >
        {submitLabel}
      </button>
    </form>
  );
}
