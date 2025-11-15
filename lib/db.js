import { resolve, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import Database from 'better-sqlite3';

const DATA_DIR = resolve(__dirname, '..', 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = join(DATA_DIR, 'queue.db');
const db = new Database(DB_PATH);

function init() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      state TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      available_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      worker TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_state_available ON jobs(state, available_at);
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // defaults
  const stmt = db.prepare('INSERT OR IGNORE INTO config(key,value) VALUES(?,?)');
  stmt.run('backoff_base', '2');
  stmt.run('default_max_retries', '3');
}

init();

export default {
  db,
  DB_PATH
};
