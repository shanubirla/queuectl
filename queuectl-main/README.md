### Change karlena readme , maine run k commands bas likhe h ispe

Start a worker (1 worker):

    node cli.js worker start --count 1 
    (link karlo globally then) -> queuectl worker start --count 1

Enqueue a quick job (complete successfully):

    queuectl enqueue '{"command":"echo Hello; exit 0"}'

Enqueue a job that fails (invalid command) to test retry + DLQ:

    queuectl enqueue '{"command":"some_nonexistent_command","max_retries":2}'

Check status:

    queuectl status

List pending jobs: 

    queuectl list --state pending

View DLQ:

    queuectl dlq list

Retry DLQ job:

    queuectl dlq retry <jobId>

Stop workers:
 
    queuectl worker stop


