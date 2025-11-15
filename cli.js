#!/usr/bin/env node
const { program } = require("commander");
const { db, DB_PATH } = require("./lib/db");
const { setConfig, getInt, getRaw } = require("./lib/config");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const WORKERS_DIR = path.resolve(__dirname, "workers");
if (!fs.existsSync(WORKERS_DIR)) fs.mkdirSync(WORKERS_DIR);

program
  .name("queuectl")
  .description("Background job queue with retries + DLQ")
  .version("1.0.0");

// ─────────────────────────────────────────
// ENQUEUE
// ─────────────────────────────────────────
program
  .command("enqueue <json>")
  .description("Enqueue a new job")
  .action((json) => {
    let job;
    try {
      job = JSON.parse(json);
    } catch (err) {
      console.error("Invalid JSON");
      process.exit(1);
    }

    if (!job.id) job.id = uuidv4();
    if (!job.command) {
      console.error(`Job must include "command"`);
      process.exit(1);
    }

    const now = new Date().toISOString();
    const maxRetries =
      job.max_retries ?? getInt("default_max_retries", 3);

    db.prepare(`
      INSERT INTO jobs (id, command, state, attempts, max_retries, created_at, updated_at, available_at)
      VALUES (?, ?, 'pending', 0, ?, ?, ?, strftime('%s','now'))
    `).run(job.id, job.command, maxRetries, now, now);

    console.log(`Enqueued job ${job.id}`);
  });

// ─────────────────────────────────────────
// LIST
// ─────────────────────────────────────────
program
  .command("list")
  .option("--state <state>")
  .description("List jobs")
  .action((opts) => {
    let rows;

    if (opts.state) {
      rows = db.prepare(`
        SELECT * FROM jobs WHERE state=? ORDER BY created_at DESC
      `).all(opts.state);
    } else {
      rows = db.prepare(`
        SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200
      `).all();
    }

    console.table(rows);
  });

// ─────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────
program
  .command("status")
  .description("Queue + worker status")
  .action(() => {
    const rows = db.prepare(`
      SELECT state, COUNT(*) AS cnt FROM jobs GROUP BY state
    `).all();

    const summary = rows.reduce((acc, r) => {
      acc[r.state] = r.cnt;
      return acc;
    }, {});

    const workers = fs.readdirSync(WORKERS_DIR).filter(f => f.endsWith(".pid"));

    console.log("DB:", DB_PATH);
    console.log("Jobs summary:", summary);
    console.log("Active workers:", workers);

    for (const f of workers) {
      const pid = fs.readFileSync(path.join(WORKERS_DIR, f), "utf8");
      console.log(` - ${f.replace(".pid","")}: pid ${pid}`);
    }
  });

// ─────────────────────────────────────────
// WORKER MANAGEMENT
// ─────────────────────────────────────────
const workerCmd = program.command("worker").description("Worker manager");

// START WORKERS (Windows-safe)
workerCmd
  .command("start")
  .option("--count <n>", "number of workers", "1")
  .option("--interval <ms>", "poll interval", "1000")
  .description("Start background workers")
  .action((opts) => {
    const count = parseInt(opts.count, 10) || 1;
    const interval = parseInt(opts.interval, 10) || 1000;
    const workerScript = path.resolve(__dirname, "lib", "worker.js");

    for (let i = 0; i < count; i++) {
      if (process.platform === "win32") {
        // WINDOWS WORKER START
        const nodeEsc = process.execPath.replace(/'/g, "''");
        const scriptEsc = workerScript.replace(/'/g, "''");

        const psCmd = `
          $p = Start-Process -WindowStyle Hidden -FilePath '${nodeEsc}' -ArgumentList '${scriptEsc}','${interval}' -PassThru;
          $p.Id
        `;

        const child = spawn("powershell.exe", [
          "-NoProfile",
          "-WindowStyle", "Hidden",
          "-Command", psCmd
        ], {
          windowsHide: true,
          stdio: ["ignore", "pipe", "inherit"]
        });

        let output = "";
        child.stdout.on("data", d => output += d.toString());

        child.on("close", () => {
          const pid = output.trim();
          if (/^\d+$/.test(pid)) {
            fs.writeFileSync(path.join(WORKERS_DIR, `worker-${pid}.pid`), pid);
            console.log(`Started worker pid=${pid}`);
          } else {
            const fake = `worker-${Date.now()}`;
            fs.writeFileSync(path.join(WORKERS_DIR, `${fake}.pid`), "UNKNOWN_PID");
            console.log(`Worker started (pid unknown). Saved ${fake}.pid`);
          }
        });

      } else {
        // LINUX + MAC
        const child = spawn(process.execPath, [workerScript, interval], {
          stdio: "ignore",
          detached: true
        });
        child.unref();

        fs.writeFileSync(path.join(WORKERS_DIR, `worker-${child.pid}.pid`), String(child.pid));
        console.log(`Started worker pid=${child.pid}`);
      }
    }
  });

// STOP WORKERS
workerCmd
  .command("stop")
  .description("Stop all workers")
  .action(() => {
    const files = fs.readdirSync(WORKERS_DIR).filter(f => f.endsWith(".pid"));

    if (files.length === 0)
      return console.log("No worker PIDs found.");

    for (const f of files) {
      const pidStr = fs.readFileSync(path.join(WORKERS_DIR, f), "utf8");
      const pid = parseInt(pidStr, 10);

      if (!isNaN(pid)) {
        try {
          process.kill(pid, "SIGTERM");
          console.log(`Stopped worker pid=${pid}`);
        } catch {
          console.log(`Could not kill pid=${pid} (likely dead)`);
        }
      }

      fs.unlinkSync(path.join(WORKERS_DIR, f));
    }
  });

// DLQ LIST + RETRY
program
  .command("dlq list")
  .description("List DLQ jobs")
  .action(() => {
    const rows = db.prepare(`
      SELECT * FROM jobs WHERE state='dead' ORDER BY updated_at DESC
    `).all();

    console.table(rows);
  });

program
  .command("dlq retry <jobId>")
  .description("Retry DLQ job")
  .action(jobId => {
    db.prepare(`
      UPDATE jobs SET state='pending', attempts=0,
      updated_at=datetime('now'), available_at=strftime('%s','now')
      WHERE id=?
    `).run(jobId);

    console.log(`Moved job ${jobId} back to pending`);
  });

program.parseAsync(process.argv);
