"use strict";

/* Small process boundary shared by future provider/coordinator work.
 * It deliberately never invokes a shell: user URLs remain ordinary argv data.
 */
const { spawn } = require("child_process");

class ProcessRunner {
  constructor(options = {}) {
    this.env = options.env || process.env;
  }

  run(executable, args = [], options = {}) {
    if (!executable || !Array.isArray(args)) throw new TypeError("executable and argv are required");
    let child;
    let timer = null;
    let settled = false;
    let stdout = "";
    let stderr = "";
    let resolveResult;
    const promise = new Promise((resolve) => { resolveResult = resolve; });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolveResult(Object.assign({ stdout, stderr }, result));
    };
    try {
      child = spawn(executable, args.map(String), {
        cwd: options.cwd,
        env: options.env || this.env,
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      finish({ code: -1, error: String(error && error.message || error) });
      return { promise, cancel: () => false };
    }
    child.stdout.on("data", (data) => {
      const text = String(data); stdout += text;
      if (options.onStdout) options.onStdout(text);
    });
    child.stderr.on("data", (data) => {
      const text = String(data); stderr += text;
      if (options.onStderr) options.onStderr(text);
    });
    child.on("error", (error) => finish({ code: -1, error: String(error && error.message || error) }));
    child.on("close", (code, signal) => finish({ code, signal: signal || null, cancelled: signal === "SIGTERM" }));
    if (Number(options.timeoutMs) > 0) timer = setTimeout(() => child.kill("SIGTERM"), Number(options.timeoutMs));
    return {
      promise,
      cancel: () => {
        if (settled) return false;
        child.kill("SIGTERM");
        return true;
      },
      child,
    };
  }
}

module.exports = { ProcessRunner };
