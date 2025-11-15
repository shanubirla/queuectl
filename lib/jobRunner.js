import { exec } from 'child_process';

function runCommand(command, timeoutMs = 0) {
  return new Promise((resolve) => {
    const child = exec(command, { shell: '/bin/bash', timeout: timeoutMs }, (error, stdout, stderr) => {
      const result = {
        success: !error,
        code: error && typeof error.code === 'number' ? error.code : 0,
        stdout: stdout ? stdout.toString() : '',
        stderr: stderr ? stderr.toString() : ''
      };
      resolve(result);
    });
  });
}

export default { runCommand };
