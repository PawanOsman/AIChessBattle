import { Chess } from 'chess.js';
import type { MoveRecord } from './gameTelemetry';

export function buildGamePgn(game: Chess, records: MoveRecord[], models: { whiteModel: string; blackModel: string }, result = '*', date = new Date()): string {
  const history = game.history({ verbose: true });
  const exported = new Chess(history[0]?.before || game.fen());
  exported.header('Event', 'AI Chess Battle', 'Site', 'Local', 'Date', `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`, 'Round', '1', 'White', models.whiteModel, 'Black', models.blackModel, 'Result', result);
  const byPly = new Map(records.map(record => [record.ply, record]));
  history.forEach((move, index) => {
    exported.move({ from: move.from, to: move.to, promotion: move.promotion });
    const record = byPly.get(index + 1);
    if (record) exported.setComment(`[%emt ${(record.durationMs / 1000).toFixed(3)}]${record.reasoning ? ` ${record.reasoning.replace(/[{}]/g, '')}` : ''}`);
  });
  return exported.pgn({ maxWidth: 90 });
}

export function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
