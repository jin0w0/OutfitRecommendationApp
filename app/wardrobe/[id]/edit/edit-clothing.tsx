"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Clothing } from "@/lib/outfit/wardrobe";
import { replaceClothingPhoto, updateClothing } from "../../actions";
import { ClothingForm, fieldsOf, shrink } from "../../clothing-form";

// Keyed like the 옷 등록 form: every visit by a link starts from the piece as
// saved, not from what was left in the form last time.
export function EditClothing({ clothing }: { clothing: Clothing }) {
  const { bfcacheId } = useRouter();
  return <ClothingEditor key={bfcacheId} clothing={clothing} />;
}

function ClothingEditor({ clothing }: { clothing: Clothing }) {
  const router = useRouter();
  const { id } = clothing;
  return (
    <div className="flex flex-col gap-8">
      <ReplacePhoto clothingId={id} onReplaced={() => router.refresh()} />
      <ClothingForm
        initial={fieldsOf(clothing)}
        initialFrequency={clothing.estimatedWearFrequency}
        submitLabel="저장"
        onSubmit={async (changed, frequency) => {
          const result = await updateClothing(id, { clothing: changed, estimatedWearFrequency: frequency });
          if (result.ok) router.push(`/wardrobe/${id}`);
          return result;
        }}
      />
    </div>
  );
}

function ReplacePhoto({ clothingId, onReplaced }: { clothingId: string; onReplaced: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [replacing, startReplacing] = useTransition();

  function replace(file: File) {
    setMessage(null);
    startReplacing(async () => {
      let photo: Blob;
      try {
        photo = await shrink(file);
      } catch {
        setMessage("이 사진은 열 수 없어요. JPEG나 PNG로 된 사진을 골라 주세요.");
        return;
      }
      const formData = new FormData();
      formData.set("clothingId", clothingId);
      formData.set("photo", photo, "photo.jpg");
      const result = await replaceClothingPhoto(formData);
      if (result.ok) onReplaced();
      else setMessage(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="self-start cursor-pointer rounded-full border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">
        {replacing ? "사진 바꾸는 중…" : "사진 바꾸기"}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={replacing}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) replace(file);
          }}
        />
      </label>
      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}
    </div>
  );
}
