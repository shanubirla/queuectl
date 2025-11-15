#!/usr/bin/env bash
set -e
echo "Starting 2 workers..."
node ../cli.js worker start --count 2
echo "Enqueue a quick success job..."
node ../cli.js enqueue '{"command":"echo hello world; exit 0"}'
echo "Enqueue a failing job with max_retries 2..."
node ../cli.js enqueue '{"command":"nonexistent_cmd","max_retries":2}'
sleep 2
node ../cli.js status
echo "Waiting 8 seconds for retries..."
sleep 10
node ../cli.js dlq list
node ../cli.js worker stop