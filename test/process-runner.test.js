"use strict";

const assert = require("assert");
const process = require("process");
const { ProcessRunner } = require("../js/process-runner");

(async () => {
  const runner = new ProcessRunner();
  const completed = runner.run(process.execPath, ["-e", "process.stdout.write('ok')"]);
  const result = await completed.promise;
  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.stdout, "ok");

  const running = runner.run(process.execPath, ["-e", "setTimeout(() => {}, 10000)"]);
  assert.strictEqual(running.cancel(), true);
  const cancelled = await running.promise;
  assert.strictEqual(cancelled.cancelled, true);
  console.log("process runner tests: ok");
})().catch((error) => { console.error(error); process.exitCode = 1; });
