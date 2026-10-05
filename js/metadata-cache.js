"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { isSignedMediaUrl } = require("./providers");

function normalizeSourceUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    url.searchParams.sort();
    return url.href;
  } catch (_) {
    return String(value || "");
  }
}

function cacheKey({ provider = "", sourceUrl = "", format = "" } = {}) {
  return crypto.createHash("sha256")
    .update([provider, normalizeSourceUrl(sourceUrl), format].map(String).join("\n"))
    .digest("hex");
}

function sanitizeMetadata(metadata = {}) {
  const scrub = (value) => {
    if (Array.isArray(value)) return value.map(scrub);
    if (!value || typeof value !== "object") return value;
    const copy = {};
    for (const [key, item] of Object.entries(value)) {
      if ((key === "url" || key === "sourceUrl") && isSignedMediaUrl(item)) continue;
      copy[key] = scrub(item);
    }
    return copy;
  };
  return scrub(JSON.parse(JSON.stringify(metadata || {})));
}

class MetadataCache {
  constructor(directory, options = {}) {
    this.directory = directory;
    this.ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : 15 * 60 * 1000;
  }

  fileFor(request) { return path.join(this.directory, cacheKey(request) + ".json"); }

  get(request, now = Date.now()) {
    let entry;
    const file = this.fileFor(request);
    try { entry = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (_) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch (_) {}
      return { hit: false, reason: "miss" };
    }
    if (!entry || !entry.createdAt || now - entry.createdAt > (entry.ttlMs || this.ttlMs)) {
      try { fs.unlinkSync(this.fileFor(request)); } catch (_) {}
      return { hit: false, reason: "expired" };
    }
    return { hit: true, metadata: entry.metadata };
  }

  set(request, metadata, now = Date.now()) {
    fs.mkdirSync(this.directory, { recursive: true });
    const file = this.fileFor(request);
    const temporary = file + ".tmp-" + process.pid;
    const entry = { version: 1, createdAt: now, ttlMs: this.ttlMs, metadata: sanitizeMetadata(metadata) };
    fs.writeFileSync(temporary, JSON.stringify(entry), "utf8");
    fs.renameSync(temporary, file);
    return entry.metadata;
  }
}

module.exports = { MetadataCache, cacheKey, normalizeSourceUrl, sanitizeMetadata };
