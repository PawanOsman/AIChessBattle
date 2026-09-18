import type { ActiveAIRequest, AIRequestRecord, MoveRecord } from './gameTelemetry';

export interface SeatStats {
  completedMoves: number;
  successfulTimeMs: number;
  totalRequestTimeMs: number;
  averageMoveMs: number | null;
  lastMoveMs: number | null;
  fastestMoveMs: number | null;
  slowestMoveMs: number | null;
  failedRequests: number;
  cancelledRequests: number;
}

const safeDuration = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;

export function activeRequestDuration(activeRequest: ActiveAIRequest | null, now: number): number {
  return activeRequest ? safeDuration(now - activeRequest.startedAt) : 0;
}

/** Each seat remains separate, including when both sides use the same model. */
export function aggregateGameStats(
  moveRecords: readonly MoveRecord[],
  requestRecords: readonly AIRequestRecord[],
): Record<'w' | 'b', SeatStats> {
  const createSeat = (): SeatStats => ({
    completedMoves: 0,
    successfulTimeMs: 0,
    totalRequestTimeMs: 0,
    averageMoveMs: null,
    lastMoveMs: null,
    fastestMoveMs: null,
    slowestMoveMs: null,
    failedRequests: 0,
    cancelledRequests: 0,
  });
  const stats = { w: createSeat(), b: createSeat() };

  for (const move of moveRecords) {
    const seat = stats[move.color];
    const duration = safeDuration(move.durationMs);
    seat.completedMoves += 1;
    seat.successfulTimeMs += duration;
    seat.lastMoveMs = duration;
    seat.fastestMoveMs = seat.fastestMoveMs === null ? duration : Math.min(seat.fastestMoveMs, duration);
    seat.slowestMoveMs = seat.slowestMoveMs === null ? duration : Math.max(seat.slowestMoveMs, duration);
    seat.averageMoveMs = seat.successfulTimeMs / seat.completedMoves;
  }

  for (const request of requestRecords) {
    const seat = stats[request.color];
    seat.totalRequestTimeMs += safeDuration(request.durationMs);
    if (request.status === 'failed') seat.failedRequests += 1;
    if (request.status === 'cancelled') seat.cancelledRequests += 1;
  }

  return stats;
}
