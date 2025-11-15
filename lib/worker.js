const { db } = require('./db');
const { runCommand } = require('./jobRunner');
const { getInt } = require('./config');
const os = require('os');

const WORKER_ID = `${os.hostname()}-${process.pid}-${Date.now()}`;
let shuttingDown = false;
let currentJobId = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pickAndLockJob() {
  // jo job pending state me h usko pick karo
  const now = Math.floor(Date.now() / 1000);
  const pick = db.prepare(`
    SELECT * FROM jobs
    WHERE state = 'pending' AND available_at <= ?
    ORDER BY created_at ASC
    LIMIT 1
  `).get(now);

  if (!pick) return null;

  const claim = db.prepare(`
    UPDATE jobs
    SET state = 'processing', worker = ?, updated_at = datetime('now')
    WHERE id = ? AND state = 'pending'
  `);
  const info = claim.run(WORKER_ID, pick.id);

  if (info.changes === 1) {
    return pick;
  }
  return null;
}

async function processJob(job) {
  currentJobId = job.id;
  const backoffBase = getInt('backoff_base', 2);

  try {
    const result = await runCommand(job.command);
    const nowUtc = new Date().toISOString();

    if (result.success && result.code === 0) {
      db.prepare(`
        UPDATE jobs SET state = 'completed', updated_at = ?, worker = NULL WHERE id = ?
      `).run(nowUtc, job.id);
      console.log(`[worker ${WORKER_ID}] job ${job.id} completed`);
    } else {
      // attempts ko inctrease karo
      const attempts = job.attempts + 1;
      if (attempts > job.max_retries) {
        db.prepare(`UPDATE jobs SET state = 'dead', attempts = ?, updated_at = ?, worker = NULL WHERE id = ?`)
          .run(attempts, nowUtc, job.id);
        console.log(`[worker ${WORKER_ID}] job ${job.id} moved to DLQ (dead) after ${attempts} attempts`);
      } else {
        // backoff calculate karo
        const delaySec = Math.pow(backoffBase, attempts);
        const availableAt = Math.floor(Date.now() / 1000) + delaySec;
        db.prepare(`
          UPDATE jobs SET state='pending', attempts=?, available_at=?, updated_at=?, worker = NULL WHERE id = ?
        `).run(attempts, availableAt, nowUtc, job.id);
        console.log(`[worker ${WORKER_ID}] job ${job.id} failed (attempt ${attempts}). retrying after ${delaySec}s`);
      }
    }
  } catch (err) {
    console.error('Error processing job', err);
    // error hua to job ko pending me wapas daal do
    db.prepare(`UPDATE jobs SET state='pending', worker = NULL, updated_at = datetime('now') WHERE id = ?`).run(job.id);
  } finally {
    currentJobId = null;
  }
}

async function mainLoop(pollIntervalMs = 1000) {
  while (!shuttingDown) {
    try {
      const job = pickAndLockJob();
      if (job) {
        await processJob(job);
      } else {
        await sleep(pollIntervalMs);
      }
    } catch (err) {
      console.error('Worker main loop error:', err);
      await sleep(1000);
    }
  }

  // pehla job khtama hone tak ka wait karo
  while (currentJobId) {
    console.log(`[worker ${WORKER_ID}] waiting for current job ${currentJobId} to finish before exit...`);
    await sleep(500);
  }
  console.log(`[worker ${WORKER_ID}] exiting gracefully`);
  process.exit(0);
}

process.on('SIGINT', () => {
  console.log(`[worker ${WORKER_ID}] SIGINT received - shutting down gracefully`);
  shuttingDown = true;
});
process.on('SIGTERM', () => {
  console.log(`[worker ${WORKER_ID}] SIGTERM received - shutting down gracefully`);
  shuttingDown = true;
});

if (require.main === module) {
  const interval = parseInt(process.argv[2] || '1000', 10);
  mainLoop(interval).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { mainLoop };
