const { db } = require("./db");
const { runCommand } = require("./jobRunner");
const { getInt } = require("./config");
const { hostname } = require("os");

const WORKER_ID = `${hostname()}-${process.pid}-${Date.now()}`;
let shuttingDown = false;
let currentJobId = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickJob() {
  const now = Math.floor(Date.now() / 1000);

  const job = db.prepare(`
    SELECT * FROM jobs
    WHERE state='pending' AND available_at <= ?
    ORDER BY created_at ASC
    LIMIT 1
  `).get(now);

  if (!job) return null;

  const claimed = db.prepare(`
    UPDATE jobs SET state='processing', worker=?, updated_at=datetime('now')
    WHERE id=? AND state='pending'
  `).run(WORKER_ID, job.id);

  return claimed.changes === 1 ? job : null;
}

async function processJob(job) {
  currentJobId = job.id;

  try {
    const backoff = getInt("backoff_base", 2);
    const result = await runCommand(job.command);
    const nowUtc = new Date().toISOString();

    if (result.success) {
      db.prepare(`
        UPDATE jobs SET state='completed', worker=NULL, updated_at=?
        WHERE id=?
      `).run(nowUtc, job.id);

      console.log(`[worker ${WORKER_ID}] completed job ${job.id}`);
    } else {
      const attempts = job.attempts + 1;

      if (attempts > job.max_retries) {
        db.prepare(`
          UPDATE jobs SET state='dead', attempts=?, worker=NULL, updated_at=?
          WHERE id=?
        `).run(attempts, nowUtc, job.id);

        console.log(`[worker ${WORKER_ID}] job ${job.id} → DLQ`);
      } else {
        const delay = Math.pow(backoff, attempts);
        const next = Math.floor(Date.now() / 1000) + delay;

        db.prepare(`
          UPDATE jobs SET state='pending', attempts=?, available_at=?, worker=NULL, updated_at=?
          WHERE id=?
        `).run(attempts, next, nowUtc, job.id);

        console.log(`[worker ${WORKER_ID}] retry job ${job.id} in ${delay}s`);
      }
    }

  } catch (err) {
    console.error(`[worker ${WORKER_ID}] error`, err);
    db.prepare(`
      UPDATE jobs SET state='pending', worker=NULL WHERE id=?
    `).run(job.id);

  } finally {
    currentJobId = null;
  }
}

async function main(interval = 1000) {
  console.log(`[worker ${WORKER_ID}] started (PID=${process.pid})`);

  while (!shuttingDown) {
    try {
      const job = pickJob();
      if (job) await processJob(job);
      else await sleep(interval);

    } catch (err) {
      console.error(`[worker ${WORKER_ID}] loop error`, err);
      await sleep(500);
    }
  }

  // Wait for the last job
  while (currentJobId) await sleep(200);

  console.log(`[worker ${WORKER_ID}] exiting`);
  process.exit(0);
}

process.on("SIGTERM", () => shuttingDown = true);
process.on("SIGINT", () => shuttingDown = true);

if (require.main === module) {
  const interval = parseInt(process.argv[2] || "1000", 10);
  main(interval);
}

module.exports = { main };
