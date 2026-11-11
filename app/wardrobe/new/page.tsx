import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAccount } from "@/lib/account/server";
import { RegisterForm } from "./register-form";

export default function RegisterClothing() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">옷 등록</h1>
        <a href="/wardrobe" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          옷장으로
        </a>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        옷 한 벌이 잘 보이게 찍은 사진 한 장을 골라 주세요. AI가 채운 내용은 저장하기 전에 확인하고 고칠 수 있어요.
      </p>
      <Suspense fallback={<div className="h-40" />}>
        <SignedIn>
          <RegisterForm />
        </SignedIn>
      </Suspense>
    </main>
  );
}

async function SignedIn({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  if (!(await getAccount().getCurrentUser(requestHeaders))) redirect("/?next=/wardrobe/new");
  return children;
}
