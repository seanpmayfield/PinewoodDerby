/**
 * SQLite persistence using Node's built-in driver (no native build step).
 *
 * The current state of each derby is stored as one JSON document, and every
 * change appends a snapshot to `history` so any earlier moment can be
 * restored. A derby's state is a few hundred kilobytes at most, so this is
 * far simpler and safer than a normalised schema for an event that runs
 * once a year and must never lose data at heat 20.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Derby } from '@derby/core';

export interface DerbySummary {
  id: string;
  name: string;
  date: string;
  updatedAt: string;
}

export interface HistoryEntry {
  id: number;
  createdAt: string;
  change: string;
}

const HISTORY_KEEP = 2000;

export class DerbyStore {
  private db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS derbies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        date TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        derby_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        change TEXT NOT NULL,
        state TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS history_derby ON history(derby_id, id);
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  listDerbies(): DerbySummary[] {
    const rows = this.db
      .prepare('SELECT id, name, date, updated_at FROM derbies ORDER BY updated_at DESC')
      .all() as { id: string; name: string; date: string; updated_at: string }[];
    return rows.map((r) => ({ id: r.id, name: r.name, date: r.date, updatedAt: r.updated_at }));
  }

  load(id: string): Derby | null {
    const row = this.db.prepare('SELECT state FROM derbies WHERE id = ?').get(id) as { state: string } | undefined;
    return row ? (JSON.parse(row.state) as Derby) : null;
  }

  save(state: Derby, change: string): void {
    const now = new Date().toISOString();
    const json = JSON.stringify(state);
    this.db
      .prepare(
        `INSERT INTO derbies (id, name, date, updated_at, state) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, date = excluded.date, updated_at = excluded.updated_at, state = excluded.state`,
      )
      .run(state.id, state.name, state.date, now, json);
    this.db.prepare('INSERT INTO history (derby_id, created_at, change, state) VALUES (?, ?, ?, ?)').run(state.id, now, change, json);
    this.db
      .prepare(
        `DELETE FROM history WHERE derby_id = ? AND id NOT IN (
           SELECT id FROM history WHERE derby_id = ? ORDER BY id DESC LIMIT ?)`,
      )
      .run(state.id, state.id, HISTORY_KEEP);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM history WHERE derby_id = ?').run(id);
    this.db.prepare('DELETE FROM derbies WHERE id = ?').run(id);
  }

  history(derbyId: string, limit = 100): HistoryEntry[] {
    const rows = this.db
      .prepare('SELECT id, created_at, change FROM history WHERE derby_id = ? ORDER BY id DESC LIMIT ?')
      .all(derbyId, limit) as { id: number; created_at: string; change: string }[];
    return rows.map((r) => ({ id: r.id, createdAt: r.created_at, change: r.change }));
  }

  loadHistory(historyId: number): Derby | null {
    const row = this.db.prepare('SELECT state FROM history WHERE id = ?').get(historyId) as { state: string } | undefined;
    return row ? (JSON.parse(row.state) as Derby) : null;
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  close(): void {
    this.db.close();
  }
}
