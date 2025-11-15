const { program } = require("commander");
const { db, DB_PATH } = require("./lib/db").default;
const { setConfig, getInt, getRaw } = require("./lib/config");
const { fork, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const WORKERS_DIR = path.resolve(__dirname, "workers");
if (!fs.existsSync(WORKERS_DIR)) fs.mkdirSync(WORKERS_DIR);

program
  .name("queuectl")
  .description("CLI for background job queue with retries and DLQ")
  .version("1.0.0");

program
  .command("enqueue <json>")
  .description("Add a new job to the queue. Provide job as JSON string")
  .action((json) => {
    let job;
    try {
      job = JSON.parse(json);
    } catch (e) {
      console.error("Invalid JSON");
      process.exit(1);
    }
    if (!job.id) job.id = uuidv4();
    if (!job.command) {
      console.error('Job must include "command" field');
      process.exit(1);
    }
    const now = new Date().toISOString();
    const maxRetries =
      job.max_retries != null
        ? job.max_retries
        : getInt("default_max_retries", 3);
    db.prepare(
      `
      INSERT INTO jobs (id, command, state, attempts, max_retries, created_at, updated_at, available_at)
      VALUES (?, ?, 'pending', 0, ?, ?, ?, strftime('%s','now'))
    `
    ).run(job.id, job.command, maxRetries, now, now);

    console.log(`Enqueued job ${job.id}`);
  });

program
  .command("list")
  .option("--state <state>", "filter by state")
  .description("List jobs (optionally filtered by state)")
  .action((opts) => {
    let rows;
    if (opts.state) {
      rows = db
        .prepare("SELECT * FROM jobs WHERE state = ? ORDER BY created_at DESC")
        .all(opts.state);
    } else {
      rows = db
        .prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200")
        .all();
    }
    console.table(
      rows.map((r) => ({
        id: r.id,
        command: r.command,
        state: r.state,
        attempts: r.attempts,
        max_retries: r.max_retries,
        created_at: r.created_at,
        updated_at: r.updated_at,
        available_at: r.available_at,
      }))
    );
  });

program
  .command("status")
  .description("Show summary of job states and active worker PIDs")
  .action(() => {
    const rows = db
      .prepare(
        `
      SELECT state, COUNT(*) as cnt FROM jobs GROUP BY state
    `
      )
      .all();
    const summary = rows.reduce((acc, r) => {
      acc[r.state] = r.cnt;
      return acc;
    }, {});
    const workers = fs
      .readdirSync(WORKERS_DIR)
      .filter((f) => f.endsWith(".pid"));
    console.log("DB:", DB_PATH);
    console.log("Jobs summary:", summary);
    console.log("Active workers (pid files):", workers);
    workers.forEach((f) => {
      const pid = fs.readFileSync(path.join(WORKERS_DIR, f), "utf8");
      console.log(` - ${f.replace(".pid", "")}: pid ${pid}`);
    });
  });

// worker management commands
const worker = program.command("worker").description("Manage worker processes");

worker
  .command("start")
  .option("--count <n>", "number of worker processes", "1")
  .option("--interval <ms>", "poll interval in ms", "1000")
  .description("Start worker(s)")
  .action((opts) => {
    const count = parseInt(opts.count, 10) || 1;
    const interval = parseInt(opts.interval, 10) || 1000;

    const workerScript = path.resolve(__dirname, "lib", "worker.js");

    for (let i = 0; i < count; i++) {
      const child = spawn(process.execPath, [workerScript, String(interval)], {
        stdio: ["ignore", "inherit", "inherit"],
        detached: true,
      });
      child.unref();

      const pidFile = path.join(WORKERS_DIR, `worker-${child.pid}.pid`);
      fs.writeFileSync(pidFile, String(child.pid), "utf8");

      console.log(`Started worker pid=${child.pid}`);
    }
  });

worker
  .command("stop")
  .description("Stop all worker processes")
  .action(() => {
    const files = fs.readdirSync(WORKERS_DIR).filter((f) => f.endsWith(".pid"));

    if (files.length === 0) {
      console.log("No workers running.");
      return;
    }

    files.forEach((f) => {
      const pid = parseInt(
        fs.readFileSync(path.join(WORKERS_DIR, f), "utf8"),
        10
      );

      try {
        process.kill(pid, "SIGTERM");
        console.log(`Sent SIGTERM to worker pid=${pid}`);
      } catch (e) {
        console.log(`Could not stop pid=${pid} (probably already exited)`);
      }

      fs.unlinkSync(path.join(WORKERS_DIR, f));
    });
  });

program
  .command("dlq list")
  .description("List jobs in Dead Letter Queue (state=dead)")
  .action(() => {
    const rows = db
      .prepare(
        "SELECT * FROM jobs WHERE state = 'dead' ORDER BY updated_at DESC"
      )
      .all();
    console.table(
      rows.map((r) => ({
        id: r.id,
        command: r.command,
        attempts: r.attempts,
        max_retries: r.max_retries,
        updated_at: r.updated_at,
      }))
    );
  });

program
  .command("dlq retry <jobId>")
  .description("Retry a job from DLQ (move back to pending and reset attempts)")
  .action((jobId) => {
    const job = db
      .prepare("SELECT * FROM jobs WHERE id = ? AND state = 'dead'")
      .get(jobId);
    if (!job) {
      console.error("DLQ job not found:", jobId);
      process.exit(1);
    }
    db.prepare(
      'UPDATE jobs SET state = "pending", attempts = 0, updated_at = datetime("now"), available_at = strftime("%s","now") WHERE id = ?'
    ).run(jobId);
    console.log(`Moved job ${jobId} back to pending`);
  });

program
  .command("config set <key> <value>")
  .description("Set configuration (backoff_base, default_max_retries)")
  .action((key, value) => {
    setConfig(key, value);
    console.log(`Config ${key} set to ${value}`);
  });

program
  .command("config get <key>")
  .description("Get configuration value")
  .action((key) => {
    const v = getRaw(key);
    console.log(`${key} = ${v}`);
  });

program.parseAsync(process.argv);
