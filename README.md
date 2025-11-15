# queuectl — Job Queue and Worker System

`queuectl` is a lightweight CLI-based job queue system implemented in Node.js. It provides background job processing, worker management, retries, and a Dead Letter Queue (DLQ). It is designed to be simple, extensible, and framework-independent.

---

## 1. Setup Instructions

### Clone the repository and install dependencies

```bash
git clone <repository-url>
cd queuectl
npm install
```

### Running the CLI (local)

```bash
node cli.js <command>
```

### Optional: Install globally

```bash
npm link
queuectl <command>
```

---

## 2. Usage Examples

### Start workers

Start a single worker:

```bash
node cli.js worker start --count 1
```

After global linking:

```bash
queuectl worker start --count 1
```

### Enqueue a successful job

```bash
queuectl enqueue '{"command":"echo Hello; exit 0"}'
```

### Enqueue a failing job (tests retries + DLQ)

```bash
queuectl enqueue '{"command":"some_nonexistent_command","max_retries":2}'
```

### Check system status

```bash
queuectl status
```

### List pending jobs

```bash
queuectl list --state pending
```

### View DLQ

```bash
queuectl dlq list
```

### Retry a job from DLQ

```bash
queuectl dlq retry <jobId>
```

### Stop workers

```bash
queuectl worker stop
```

---

## 3. Architecture Overview

### Job Lifecycle

1. **Enqueue**
   Jobs are stored with: command, state, retries, timestamps, and metadata.

2. **Execution**
   Workers poll for pending jobs and execute them using `child_process.spawn`.

3. **Retries**
   Failures decrement retry counts. When retries are exhausted, the job is moved to the DLQ.

4. **Completion**
   Successfully executed jobs are marked as completed.

### Data Persistence

* Jobs are stored in a JSON-based datastore (`db.json`).
* DLQ exists as an isolated collection within the same data file.
* All operations use synchronous or atomic writes to avoid corruption during concurrent worker operations.

### Worker Logic

* Workers continuously fetch pending jobs in FIFO order.
* Each worker runs one job at a time.
* Workers can be scaled with:

  ```bash
  queuectl worker start --count <N>
  ```
* Workers track job states: pending → running → completed/failed.

---

## 4. Assumptions and Trade-offs

### Assumptions

* Single-machine execution; clustering/distributed workers are not included.
* Shell commands are used as job definitions.
* JSON file storage is sufficient for the intended scale.

### Trade-offs

* JSON storage limits throughput compared to real databases or message brokers.
* No delayed jobs or scheduling support.
* Worker coordination is cooperative, not centralized.

These trade-offs were intentionally made to maintain simplicity and clarity of the system design.

---

## 5. Testing Instructions

### 1. Start a worker

```bash
queuectl worker start --count 1
```

### 2. Test a successful job

```bash
queuectl enqueue '{"command":"echo Test OK; exit 0"}'
```

### 3. Test a failing job

```bash
queuectl enqueue '{"command":"invalid_cmd","max_retries":2}'
```

### 4. Verify DLQ behavior

```bash
queuectl dlq list
```

### 5. Retry a DLQ job

```bash
queuectl dlq retry <jobId>
```

### 6. Stop all workers

```bash
queuectl worker stop
```



