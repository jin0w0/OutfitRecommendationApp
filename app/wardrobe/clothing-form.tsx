"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { Draft } from "@/lib/outfit/closet";
import {
  COLOR_NAMES,
  ESTIMATED_WEAR_FREQUENCY_NAMES,
  FORMALITY_NAMES,
  MATERIAL_NAMES,
  SEASON_NAMES,
  SLOT_NAMES,
  STYLE_NAMES,
  WARMTH_NAMES,
} from "@/lib/outfit/clothing-names";
import {
  COLORS,
  ESTIMATED_WEAR_FREQUENCIES,
  FORMALITIES,
  MATERIALS,
  SEASONS,
  SLOTS,
  STYLES,
  WARMTHS,
  type Clothing,
  type ClothingFields,
  type EstimatedWearFrequency,
} from "@/lib/outfit/wardrobe";

// Photos are shrunk in the browser before upload: smaller to send, cheaper to analyse.
const MAX_SIDE = 1600;

// The fields of a stored piece, as the form edits them.
export function fieldsOf({ name, slot, color, seasons, style, formality, warmth, material }: Clothing): ClothingFields {
  return { name, slot, color, seasons, style, formality, warmth, material };
}

// The fields of a piece and its 추정 착용 빈도, for 옷 등록 (filled from the
// AI's draft) and 고치기 (filled from the piece). Nothing is saved until every
// field and the 착용 빈도 are chosen.
export function ClothingForm({
  initial,
  initialFrequency = null,
  notices,
  submitLabel,
  onSubmit,
}: {
  initial: Draft;
  initialFrequency?: EstimatedWearFrequency | null;
  notices?: ReactNode;
  submitLabel: string;
  onSubmit: (clothing: ClothingFields, frequency: EstimatedWearFrequency) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [frequency, setFrequency] = useState<EstimatedWearFrequency | null>(initialFrequency);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft({ ...draft, [field]: value });

  const missing = Object.entries(draft)
    .filter(([, value]) => value === null || value === "" || (Array.isArray(value) && value.length === 0))
    .map(([field]) => field);

  function save() {
    if (missing.length > 0 || !frequency) {
      setMessage("비어 있는 항목과 착용 빈도를 모두 골라 주세요.");
      return;
    }
    startSaving(async () => {
      const result = await onSubmit(draft as ClothingFields, frequency);
      if (!result.ok) setMessage(result.message ?? "저장하지 못했어요.");
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {notices}

      <Field label="이름">
        <input
          value={draft.name ?? ""}
          onChange={(event) => set("name", event.target.value || null)}
          className="h-10 rounded-md border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
        />
      </Field>
      <Choice label="종류" values={SLOTS} names={SLOT_NAMES} value={draft.slot} onChange={(v) => set("slot", v)} />
      <Choice label="색상" values={COLORS} names={COLOR_NAMES} value={draft.color} onChange={(v) => set("color", v)} />
      <Field label="계절">
        <div className="flex gap-3">
          {SEASONS.map((season) => (
            <label key={season} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={draft.seasons?.includes(season) ?? false}
                onChange={(event) => {
                  const others = (draft.seasons ?? []).filter((s) => s !== season);
                  const seasons = event.target.checked ? [...others, season] : others;
                  set("seasons", seasons.length ? SEASONS.filter((s) => seasons.includes(s)) : null);
                }}
              />
              {SEASON_NAMES[season]}
            </label>
          ))}
        </div>
      </Field>
      <Choice label="스타일" values={STYLES} names={STYLE_NAMES} value={draft.style} onChange={(v) => set("style", v)} />
      <Choice
        label="격식 수준"
        values={FORMALITIES}
        names={FORMALITY_NAMES}
        value={draft.formality}
        onChange={(v) => set("formality", v)}
      />
      <Choice label="두께" values={WARMTHS} names={WARMTH_NAMES} value={draft.warmth} onChange={(v) => set("warmth", v)} />
      <Choice
        label="소재"
        values={MATERIALS}
        names={MATERIAL_NAMES}
        value={draft.material}
        onChange={(v) => set("material", v)}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">이 옷을 얼마나 자주 입나요?</legend>
        {ESTIMATED_WEAR_FREQUENCIES.map((value) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="frequency"
              checked={frequency === value}
              onChange={() => setFrequency(value)}
            />
            {ESTIMATED_WEAR_FREQUENCY_NAMES[value]}
          </label>
        ))}
      </fieldset>

      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}
      <button
        type="submit"
        disabled={saving}
        className="h-11 rounded-full bg-foreground px-6 text-background disabled:opacity-50"
      >
        {saving ? "저장하는 중…" : submitLabel}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

// A select over a value list; "" stands for not chosen yet.
function Choice<T extends string | number>({
  label,
  values,
  names,
  value,
  onChange,
}: {
  label: string;
  values: readonly T[];
  names: Record<T, string>;
  value: T | null;
  onChange: (value: T | null) => void;
}) {
  return (
    <Field label={label}>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(values.find((v) => String(v) === event.target.value) ?? null)}
        className="h-10 rounded-md border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
      >
        <option value="">골라 주세요</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {names[v]}
          </option>
        ))}
      </select>
    </Field>
  );
}

// Re-encodes the photo as a JPEG whose longer side is at most MAX_SIDE.
export async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode"))), "image/jpeg", 0.85),
  );
}
