"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AnalysedPhoto } from "@/lib/outfit/closet";
import { analyseClothingPhoto, registerClothing } from "../actions";
import { ClothingForm, shrink } from "../clothing-form";

// How many photos can be picked together.
const MAX_PHOTOS = 10;

type Stage =
  | { name: "pick" }
  | { name: "analysing"; preview: string }
  | { name: "confirm"; preview: string; analysed: AnalysedPhoto };

// The photos picked together are gone through one at a time: each is
// analysed when its turn comes, confirmed or skipped, then the next.
export function RegisterForm() {
  const router = useRouter();
  const [queue, setQueue] = useState<File[]>([]);
  const [position, setPosition] = useState(0);
  const [stage, setStage] = useState<Stage>({ name: "pick" });
  const [error, setError] = useState<string | null>(null);

  async function start(files: File[]) {
    setQueue(files);
    setPosition(0);
    await analyse(files, 0);
  }

  async function analyse(files: File[], index: number) {
    if (index >= files.length) {
      router.push("/wardrobe");
      return;
    }
    setPosition(index);
    setError(null);
    let photo: Blob;
    try {
      photo = await shrink(files[index]);
    } catch {
      setError("이 사진은 열 수 없어요. JPEG나 PNG로 된 사진을 골라 주세요.");
      setStage({ name: "pick" });
      return;
    }
    const preview = URL.createObjectURL(photo);
    setStage({ name: "analysing", preview });
    const formData = new FormData();
    formData.set("photo", photo, "photo.jpg");
    const result = await analyseClothingPhoto(formData);
    if (!result.ok) {
      setError(result.message);
      setStage({ name: "pick" });
      return;
    }
    setStage({ name: "confirm", preview, analysed: result.analysed });
  }

  const next = () => void analyse(queue, position + 1);
  const progress = queue.length > 1 && (
    <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
      <span>
        {position + 1} / {queue.length}
      </span>
      <button type="button" onClick={next} className="underline">
        이 사진 건너뛰기
      </button>
    </div>
  );

  if (stage.name === "pick") {
    return (
      <div className="flex flex-col gap-3">
        <label className="flex h-40 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          옷 사진 찍기 또는 고르기
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(event) => {
              const files = [...(event.target.files ?? [])].slice(0, MAX_PHOTOS);
              if (files.length) void start(files);
            }}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {error && position + 1 < queue.length && (
          <button type="button" onClick={next} className="self-start text-sm underline">
            다음 사진으로
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {progress}
      {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
      <img src={stage.preview} alt="올린 옷 사진" className="max-h-72 self-start rounded-lg" />
      {stage.name === "analysing" ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">AI가 사진을 보고 있어요…</p>
      ) : (
        <ConfirmForm key={stage.analysed.photoId} analysed={stage.analysed} onSaved={next} />
      )}
    </div>
  );
}
function ConfirmForm({ analysed, onSaved }: { analysed: AnalysedPhoto; onSaved: () => void }) {
  return (
    <ClothingForm
      initial={analysed.draft}
      submitLabel="옷장에 넣기"
      notices={
        <>
          {analysed.analysis === "failed" && (
            <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm dark:bg-amber-950">
              AI가 사진을 분석하지 못했어요. 항목을 직접 골라 주세요.
            </p>
          )}
          {!analysed.looksLikeClothing && (
            <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm dark:bg-amber-950">
              사진에서 옷을 찾지 못했어요. 다른 사진을 고르거나, 맞다면 항목을 직접 채워 주세요.
            </p>
          )}
        </>
      }
      onSubmit={async (clothing, estimatedWearFrequency) => {
        const result = await registerClothing({ photoId: analysed.photoId, clothing, estimatedWearFrequency });
        if (result.ok) onSaved();
        return result;
      }}
    />
  );
}
