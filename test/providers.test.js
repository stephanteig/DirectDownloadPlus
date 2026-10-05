"use strict";

const assert = require("assert");
const p = require("../js/providers");

assert.strictEqual(p.extensionOf("https://cdn.example/a.MP4?token=x"), "mp4");
assert.strictEqual(p.extensionOf("javascript:alert(1)"), "");

assert.strictEqual(p.durationFrom({ duration: 0, requested_formats: [{ duration: 12.5 }] }), 12.5);
assert.strictEqual(p.durationFrom({ formats: [{ duration_s: 8 }] }), 8);
assert.strictEqual(p.durationFrom({ duration: null, formats: [{ duration: 0 }] }), 0);

const direct = p.directFileProvider("https://cdn.example/reel.MP4?sig=short");
assert.strictEqual(direct.provider, "direct-file");
assert.strictEqual(direct.kind, "video");
assert.strictEqual(direct.capabilities.supportsVideo, true);
assert.strictEqual(p.directFileProvider("https://example.com/page"), null);
assert.strictEqual(p.resolveProvider("https://example.com/page").provider, "yt-dlp");

const reel = p.normalizeYTDLP({
  id: "reel", title: "Reel", uploader: "creator", duration: 0,
  requested_formats: [{ duration: 17 }], formats: [{ height: 1080, ext: "mp4" }],
}, "https://www.instagram.com/reels/example/");
assert.strictEqual(reel.provider, "yt-dlp");
assert.strictEqual(reel.duration, 17);
assert.strictEqual(reel.kind, "video");
assert.strictEqual(reel.capabilities.supportsTrim, true);

const collection = p.normalizeYTDLP({ _type: "playlist", title: "Set", entries: [{ id: "1", title: "One" }] }, "https://example.com/list");
assert.strictEqual(collection.kind, "collection");
assert.strictEqual(collection.items.length, 1);

assert.strictEqual(p.classifyProviderError("Sign in to confirm"), "authentication-required");
assert.strictEqual(p.classifyProviderError("live stream"), "active-livestream");

console.log("provider tests: ok");
