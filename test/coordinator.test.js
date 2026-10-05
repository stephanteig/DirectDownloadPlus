"use strict";
const assert = require("assert");
const { DownloadCoordinator } = require("../js/download-coordinator");

(async () => {
  const c = new DownloadCoordinator({ maxAttempts: 2 });
  let attempts = 0;
  const first = c.enqueue(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("transient");
    return { value: 7 };
  });
  const second = c.enqueue(async () => ({ value: 8 }));
  const a = await first.promise;
  const b = await second.promise;
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a.attempts, 2);
  assert.strictEqual(b.value, 8);
  assert.strictEqual(c.state(first.id), "completed");
  assert.strictEqual(c.state(second.id), "completed");

  const cancellable = new DownloadCoordinator({ maxAttempts: 1 });
  let stop;
  const active = cancellable.enqueue(({ cancel }) => new Promise((resolve) => {
    stop = () => { resolve({ stopped: true }); };
    cancel(stop);
  }));
  while (typeof stop !== "function") await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(cancellable.cancel(active.id), true);
  const cancelled = await active.promise;
  assert.strictEqual(cancelled.cancelled, true);
  assert.strictEqual(cancellable.state(active.id), "cancelled");

  const resultRetry = new DownloadCoordinator({ maxAttempts: 2 });
  let resultAttempts = 0;
  const retryResult = resultRetry.enqueue(async () => {
    resultAttempts += 1;
    return resultAttempts === 1 ? { ok: false, providerError: "provider-failed" } : { value: 9 };
  }, { shouldRetry: (error) => error.providerError === "provider-failed" });
  const retried = await retryResult.promise;
  assert.strictEqual(retried.ok, true);
  assert.strictEqual(retried.attempts, 2);
  console.log("coordinator tests: ok");
})();
