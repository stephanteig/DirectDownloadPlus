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
  console.log("coordinator tests: ok");
})();
