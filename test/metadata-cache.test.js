"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { MetadataCache, cacheKey, normalizeSourceUrl } = require("../js/metadata-cache");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ddp-cache-"));
try {
  const cache = new MetadataCache(directory, { ttlMs: 100 });
  const request = { provider: "yt-dlp", sourceUrl: "https://instagram.com/reel/1", format: "video" };
  assert.strictEqual(cacheKey(request).length, 64);
  assert.strictEqual(normalizeSourceUrl("https://example.com/x?b=2&a=1#fragment"), "https://example.com/x?a=1&b=2");
  assert.strictEqual(cacheKey(request), cacheKey({ provider: "yt-dlp", sourceUrl: "https://instagram.com/reel/1#player", format: "video" }));
  assert.strictEqual(cache.get(request).hit, false);
  cache.set(request, { provider: "yt-dlp", title: "Reel", sourceUrl: "https://v16.cdninstagram.com/x.mp4?sig=abc", formats: [{ url: "https://cdninstagram.com/x?oe=1" }] }, 1000);
  const hit = cache.get(request, 1050);
  assert.strictEqual(hit.hit, true);
  assert.strictEqual(hit.metadata.sourceUrl, "");
  assert.strictEqual(hit.metadata.formats[0].url, undefined);
  assert.strictEqual(cache.get(request, 1201).reason, "expired");
  fs.writeFileSync(cache.fileFor(request), "not-json", "utf8");
  assert.strictEqual(cache.get(request).reason, "miss");
  assert.strictEqual(fs.existsSync(cache.fileFor(request)), false);
  console.log("metadata cache tests: ok");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
