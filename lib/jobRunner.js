const { exec } = require("child_process");
const os = require("os");

function runCommand(command) {
  return new Promise((resolve) => {
    const shell = os.platform() === "win32" ? "cmd.exe" : "/bin/bash";

    exec(
      command,
      { shell, windowsHide: true },
      (error, stdout, stderr) => {
        const code =
          error && typeof error.code === "number" ? error.code : 0;

        resolve({
          success: code === 0,
          code,
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? ""
        });
      }
    );
  });
}

module.exports = { runCommand };
