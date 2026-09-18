/** Compact, consistently rounded duration for move and request timing. */
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs)) return '—';
  const milliseconds = Math.max(0, Math.round(durationMs));
  if (milliseconds < 1000) return `${milliseconds} ms`;
  if (Math.round(milliseconds / 100) < 600) return `${(milliseconds / 1000).toFixed(1)} s`;

  const seconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = String(seconds % 60).padStart(2, '0');
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m ${remainingSeconds}s`;
}
