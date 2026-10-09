import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AlertFields, AlertRecord, EditRecord } from './types.ts';

const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000; // RF-29

// RF-11: hash de (ticker, Entrada, SL, TP) tal como vienen en la alerta. Si el objetivo
// es "por indicadores", entra como "indicadores" y no como el TP calculado, que cambia
// con cada vela: así un reenvío de la misma alerta da el mismo hash.
export function contentHash(fields: Pick<AlertFields, 'ticker' | 'entry' | 'stopLoss' | 'target'>): string {
  const tp = fields.target.kind === 'price' ? String(fields.target.price) : 'indicadores';
  return createHash('sha256')
    .update([fields.ticker, fields.entry, fields.stopLoss, tp].join('|'))
    .digest('hex')
    .slice(0, 16);
}

// RF-11: ID del mensaje de WhatsApp + hash del contenido.
export function alertId(waMessageId: string, hash: string | null): string {
  return `${waMessageId}:${hash ?? 'sin-datos'}`;
}

// Crea el archivo con 0600 antes de usarlo (RNF-10).
function touchPrivate(file: string): void {
  if (!existsSync(file)) closeSync(openSync(file, 'a', 0o600));
  chmodSync(file, 0o600);
}

export interface AlertStore {
  hasWaMessage(waMessageId: string): boolean;
  hasRecentHash(hash: string, now: Date): boolean;
  // ID de RF-11 de la primera vez que se procesó ese mensaje, o null.
  alertIdFor(waMessageId: string): string | null;
  save(record: AlertRecord): void;
  saveEdit(record: EditRecord): void;
  close(): void;
}

// Registro persistente de alertas procesadas (RF-11, RF-29) y log de RF-05.
// - SQLite: consultas de duplicados.
// - alerts.log (JSONL): una línea por alerta, para auditar con tail/jq.
export class SqliteAlertStore implements AlertStore {
  private readonly db: DatabaseSync;
  private readonly logFile: string | null;

  // dataDir null → base en memoria y sin log en disco (tests y replay).
  constructor(dataDir: string | null) {
    if (dataDir === null) {
      this.db = new DatabaseSync(':memory:');
      this.logFile = null;
    } else {
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      chmodSync(dataDir, 0o700);
      const dbFile = path.join(dataDir, 'signalbridge.db');
      touchPrivate(dbFile);
      this.db = new DatabaseSync(dbFile);
      this.logFile = path.join(dataDir, 'alerts.log');
      touchPrivate(this.logFile);
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_id TEXT NOT NULL,
        wa_message_id TEXT NOT NULL,
        content_hash TEXT,
        received_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        record TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS alerts_wa_message_id ON alerts (wa_message_id);
      CREATE INDEX IF NOT EXISTS alerts_content_hash ON alerts (content_hash, received_at);
      CREATE TABLE IF NOT EXISTS edits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_id TEXT NOT NULL,
        wa_message_id TEXT NOT NULL,
        edited_at INTEGER NOT NULL,
        record TEXT NOT NULL
      );
    `);
  }

  hasWaMessage(waMessageId: string): boolean {
    return this.db.prepare('SELECT 1 FROM alerts WHERE wa_message_id = ? LIMIT 1').get(waMessageId) !== undefined;
  }

  hasRecentHash(hash: string, now: Date): boolean {
    const since = now.getTime() - DUPLICATE_WINDOW_MS;
    return (
      this.db.prepare('SELECT 1 FROM alerts WHERE content_hash = ? AND received_at >= ? LIMIT 1').get(hash, since) !==
      undefined
    );
  }

  alertIdFor(waMessageId: string): string | null {
    const row = this.db.prepare('SELECT alert_id FROM alerts WHERE wa_message_id = ? ORDER BY id LIMIT 1').get(waMessageId) as
      | { alert_id: string }
      | undefined;
    return row?.alert_id ?? null;
  }

  saveEdit(record: EditRecord): void {
    this.db
      .prepare('INSERT INTO edits (alert_id, wa_message_id, edited_at, record) VALUES (?, ?, ?, ?)')
      .run(record.alertId, record.waMessageId, Date.parse(record.editedAt), JSON.stringify(record));
    if (this.logFile) appendFileSync(this.logFile, `${JSON.stringify(record)}\n`);
  }

  save(record: AlertRecord): void {
    this.db
      .prepare(
        'INSERT INTO alerts (alert_id, wa_message_id, content_hash, received_at, status, reason, record) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        record.alertId,
        record.waMessageId,
        record.contentHash,
        Date.parse(record.receivedAt),
        record.status,
        record.reason,
        JSON.stringify(record),
      );
    if (this.logFile) appendFileSync(this.logFile, `${JSON.stringify(record)}\n`);
  }

  close(): void {
    this.db.close();
  }
}
