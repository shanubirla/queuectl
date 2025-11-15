const { db } = require("./db");

function getRaw(key) {
  const row = db.prepare("SELECT value FROM config WHERE key=?").get(key);
  return row ? row.value : null;
}

function getInt(key, fallback) {
  const raw = getRaw(key);
  if (raw === null) return fallback;
  const v = parseInt(raw, 10);
  return Number.isNaN(v) ? fallback : v;
}

function setConfig(key, value) {
  db.prepare("INSERT OR REPLACE INTO config(key, value) VALUES (?, ?)").run(
    key,
    String(value)
  );
}

module.exports = { getRaw, getInt, setConfig };
