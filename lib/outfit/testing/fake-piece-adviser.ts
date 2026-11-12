import type { PieceAdviser } from "../one-more-piece";

// The LLM's 한 벌 후보, answering what the test prepared every time it is asked.
export class FakePieceAdviser implements PieceAdviser {
  private proposals: unknown[] = [];
  private failure: Error | null = null;
  // How many times the LLM was asked.
  calls = 0;

  willPropose(candidates: unknown[]) {
    this.proposals = candidates;
  }

  failWith(error = new Error("the LLM is down")) {
    this.failure = error;
  }

  async proposePieces() {
    this.calls++;
    if (this.failure) throw this.failure;
    return this.proposals;
  }
}
