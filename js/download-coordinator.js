"use strict";

/* Small, UI-agnostic coordinator. The existing panel still owns the visible
 * workflow; this module makes serialization, cancellation and retry explicit
 * for future queue integration and for direct-file operations. */
class DownloadCoordinator {
  constructor(options = {}) {
    this.maxAttempts = Math.max(1, Number(options.maxAttempts) || 2);
    this.active = null;
    this.queue = [];
    this.nextId = 1;
    this.states = new Map();
  }

  enqueue(run, options = {}) {
    if (typeof run !== "function") throw new TypeError("run must be a function");
    const id = options.id || "download-" + this.nextId++;
    const job = { id, run, attempts: 0, cancelled: false, resolve: null };
    const promise = new Promise((resolve) => { job.resolve = resolve; });
    this.queue.push(job);
    this.states.set(id, "queued");
    this.pump();
    return { id, promise };
  }

  cancel(id) {
    const job = this.queue.find((item) => item.id === id) || (this.active && this.active.id === id && this.active);
    if (!job) return false;
    job.cancelled = true;
    if (this.active !== job) {
      this.queue = this.queue.filter((item) => item !== job);
      this.states.set(id, "cancelled");
      job.resolve({ ok: false, cancelled: true, id });
    } else if (typeof job.cancel === "function") {
      job.cancel();
    }
    return true;
  }

  state(id) { return this.states.get(id) || "unknown"; }

  async pump() {
    if (this.active || !this.queue.length) return;
    const job = this.queue.shift();
    this.active = job;
    this.states.set(job.id, "running");
    while (!job.cancelled && job.attempts < this.maxAttempts) {
      job.attempts += 1;
      try {
        const result = await job.run({ attempt: job.attempts, cancel: (fn) => { job.cancel = fn; } });
        if (job.cancelled) break;
        this.states.set(job.id, "completed");
        job.resolve(Object.assign({ ok: true, id: job.id, attempts: job.attempts }, result || {}));
        this.active = null; this.pump(); return;
      } catch (error) {
        if (job.cancelled) break;
        if (job.attempts >= this.maxAttempts || (error && error.retryable === false)) {
          this.states.set(job.id, "failed");
          job.resolve({ ok: false, id: job.id, attempts: job.attempts, error });
          this.active = null; this.pump(); return;
        }
      }
    }
    this.states.set(job.id, "cancelled");
    job.resolve({ ok: false, id: job.id, attempts: job.attempts, cancelled: true });
    this.active = null; this.pump();
  }
}

module.exports = { DownloadCoordinator };
