import { deleteAccount } from "../actions";

export function DeleteAccountSection() {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">탈퇴</h2>
      <details className="text-sm">
        <summary className="cursor-pointer text-red-600">탈퇴하기</summary>
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <p>탈퇴하면 아래 데이터가 바로 지워지고 되돌릴 수 없어요.</p>
          <ul className="list-disc pl-5 text-zinc-600 dark:text-zinc-400">
            <li>옷장과 착용 기록</li>
            <li>받은 추천과 대화 기록</li>
            <li>캘린더 연동과 구글에 준 권한</li>
            <li>기본 지역 등 설정</li>
          </ul>
          <form action={deleteAccount}>
            <button type="submit" className="rounded-full bg-red-600 px-4 py-1.5 text-white">
              모든 데이터를 지우고 탈퇴
            </button>
          </form>
        </div>
      </details>
    </section>
  );
}
