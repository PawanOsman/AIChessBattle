export interface PendingAIMove {
  readonly fen: string;
  readonly controller: AbortController;
}

// A request belongs to one turn. Cancellation also invalidates responses from
// transports that finish despite aborting (including a new game with the same FEN).
export class AIRequestTracker {
  private pending: PendingAIMove | null = null;

  begin(fen: string): PendingAIMove | null {
    if (this.pending) return null;
    this.pending = { fen, controller: new AbortController() };
    return this.pending;
  }

  isCurrent(request: PendingAIMove, fen: string): boolean {
    return this.pending === request && !request.controller.signal.aborted && request.fen === fen;
  }

  finish(request: PendingAIMove): boolean {
    if (this.pending !== request) return false;
    this.pending = null;
    return true;
  }

  cancel(): void {
    this.pending?.controller.abort();
    this.pending = null;
  }
}
