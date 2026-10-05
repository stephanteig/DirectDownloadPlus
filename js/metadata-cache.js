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
  const value = JSON.parse(JSON.stringify(metadata || {}));
  if (value.sourceUrl && isSignedMediaUrl(value.sourceUrl)) value.sourceUrl = "";
  if (Array.isArray(value.formats)) {
    value.formats = value.formats.map((format) => {
      const copy = Object.assign({}, format);
      if (copy.url && isSignedMediaUrl(copy.url)) delete copy.url;
      return copy;
    });
  }
  return value;
}

class MetadataCache {
  constructor(directory, options = {}) {
    this.directory = directory;
    this.ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : 15 * 60 * 1000;
  }

  fileFor(request) { return path.join(this.directory, cacheKey(request) + ".json"); }

  get(request, now = Date.now()) {
    let entry;
    try { entry = JSON.parse(fs.readFileSync(this.fileFor(request), "utf8")); }
    catch (_) { return { hit: false, reason: "miss" }; }
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
