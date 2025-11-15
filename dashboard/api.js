const express = require("express");
const router = express.Router();
const { db } = require("../lib/db");

router.get("/stats", (req, res) => {
  const rows = db.prepare(`SELECT state, COUNT(*) as count FROM jobs GROUP BY state`).all();
  const stats = { pending: 0, processing: 0, completed: 0, dead: 0 };
  rows.forEach(r => stats[r.state] = r.count);
  res.json(stats);
});

router.get("/jobs", (req, res) => {
  const jobs = db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200`).all();
  res.json(jobs);
});

router.post("/dlq/retry/:id", (req, res) => {
  const id = req.params.id;
  const job = db.prepare(`SELECT * FROM jobs WHERE id = ? AND state='dead'`).get(id);
  if (!job) return res.status(404).json({ error: "Job not in DLQ" });
  
  db.prepare(`
      UPDATE jobs 
      SET state='pending', attempts=0, updated_at=datetime('now'), available_at=strftime('%s','now')
      WHERE id=?
  `).run(id);

  res.json({ ok: true });
});

module.exports = router;
