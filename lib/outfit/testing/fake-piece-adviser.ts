import type { PieceAdviser, PieceTarget } from "../one-more-piece";

// The LLM's 한 벌 후보, answering what the test prepared every time it is asked.
export class FakePieceAdviser implements PieceAdviser {
  private proposals: unknown[] = [];
  private outfitProposals: unknown[] = [];
  private requestProposals: unknown[] | null = null;
  // Every target pieces were asked for.
  targets: PieceTarget[] = [];
  private failure: Error | null = null;
  // How many times the LLM was asked.
  calls = 0;

  willPropose(candidates: unknown[]) {
    this.proposals = candidates;
  }

  // What is proposed when asked under 구매 조건 (a 구매 대화); otherwise
  // the same as without.
  willProposeForRequest(candidates: unknown[]) {
    this.requestProposals = candidates;
  }

  willProposeOutfits(outfits: unknown[]) {
    this.outfitProposals = outfits;
  }

  failWith(error = new Error("the LLM is down")) {
    this.failure = error;
  }

  async proposePieces({ target }: { target: PieceTarget }) {
    this.calls++;
    this.targets.push(target);
    if (this.failure) throw this.failure;
    if ("day" in target && target.request && this.requestProposals) return this.requestProposals;
    return this.proposals;
  }

  async proposeOutfits() {
    this.calls++;
    if (this.failure) throw this.failure;
    return this.outfitProposals;
  }
}
