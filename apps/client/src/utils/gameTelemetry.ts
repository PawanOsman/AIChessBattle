export interface MoveRecord {
  ply: number;
  color: 'w' | 'b';
  model: string;
  actualModel?: string;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  reasoning?: string;
  durationMs: number;
}

export interface AIRequestRecord {
  color: 'w' | 'b';
  model: string;
  durationMs: number;
  status: 'completed' | 'failed' | 'cancelled';
}

export interface ActiveAIRequest {
  color: 'w' | 'b';
  model: string;
  /** Monotonic performance.now() timestamp; never a wall-clock timestamp. */
  startedAt: number;
}

export interface GameTelemetrySnapshot {
  moveRecords: MoveRecord[];
  requestRecords: AIRequestRecord[];
  activeRequest: ActiveAIRequest | null;
}

/** Owns one game's timing, including work that failed or was cancelled. */
export class GameTelemetry {
  private snapshot: GameTelemetrySnapshot = {
    moveRecords: [], requestRecords: [], activeRequest: null,
  };
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  getSnapshot(): GameTelemetrySnapshot {
    return this.snapshot;
  }

  begin(color: 'w' | 'b', model: string): ActiveAIRequest | null {
    if (this.snapshot.activeRequest) return null;
    const activeRequest = { color, model, startedAt: this.now() };
    this.snapshot = { ...this.snapshot, activeRequest };
    return activeRequest;
  }

  finish(
    request: ActiveAIRequest,
    status: AIRequestRecord['status'],
    move?: Omit<MoveRecord, 'durationMs'>,
  ): GameTelemetrySnapshot | null {
    // Identity is essential: a restarted game can have the same model and FEN.
    if (this.snapshot.activeRequest !== request) return null;
    const durationMs = Math.max(0, this.now() - request.startedAt);
    const record: AIRequestRecord = {
      color: request.color, model: request.model, durationMs, status,
    };
    this.snapshot = {
      activeRequest: null,
      requestRecords: [...this.snapshot.requestRecords, record],
      moveRecords: status === 'completed' && move
        ? [...this.snapshot.moveRecords, { ...move, durationMs }]
        : this.snapshot.moveRecords,
    };
    return this.snapshot;
  }

  reset(): GameTelemetrySnapshot {
    this.snapshot = { moveRecords: [], requestRecords: [], activeRequest: null };
    return this.snapshot;
  }
}
