import { COLOR_NAMES, STYLE_NAMES } from "@/lib/outfit/clothing-names";
import { COLORS, STYLES, type Preferences } from "@/lib/outfit/wardrobe";
import { savePreferences, skipPreferences } from "./actions";

// 선호 색상·스타일, as several checkboxes each. On onboarding it can be skipped.
export function PreferencesForm({
  current,
  next,
}: {
  current: Preferences;
  next: "/onboarding" | "/settings";
}) {
  return (
    <form action={savePreferences} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">좋아하는 색상</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {COLORS.map((color) => (
            <label key={color} className="flex items-center gap-1 text-sm">
              <input type="checkbox" name="color" value={color} defaultChecked={current.colors.includes(color)} />
              {COLOR_NAMES[color]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">좋아하는 스타일</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {STYLES.map((style) => (
            <label key={style} className="flex items-center gap-1 text-sm">
              <input type="checkbox" name="style" value={style} defaultChecked={current.styles.includes(style)} />
              {STYLE_NAMES[style]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-4">
        <button type="submit" className="h-10 rounded-full bg-foreground px-5 text-background">
          {next === "/onboarding" ? "다음" : "저장"}
        </button>
        {next === "/onboarding" && (
          <button
            type="submit"
            formAction={skipPreferences}
            className="text-sm text-zinc-600 underline dark:text-zinc-400"
          >
            건너뛰기
          </button>
        )}
      </div>
    </form>
  );
}
