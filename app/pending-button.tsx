"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

// A submit button that says `pending` and cannot be pressed again while its
// form is being sent (e.g. 관심 없어요 while the LLM finds another piece).
export function PendingButton({
  children,
  pending,
  className,
}: {
  children: ReactNode;
  pending: string;
  className?: string;
}) {
  const status = useFormStatus();
  return (
    <button type="submit" disabled={status.pending} className={className}>
      {status.pending ? pending : children}
    </button>
  );
}
