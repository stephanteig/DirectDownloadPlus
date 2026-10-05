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
assert.strictEqual(p.supportsFormat(direct, "mp4"), true);
assert.strictEqual(p.supportsFormat(direct, "mp3"), false);
assert.strictEqual(p.chooseFormat(direct, "mp4").ext, "mp4");
assert.strictEqual(p.directFileProvider("https://example.com/page"), null);
assert.strictEqual(p.directFileProvider("https://example.com/download?id=7", "audio/mpeg").kind, "audio");
assert.strictEqual(p.directFileProvider("https://example.com/download?id=7", "video/mp4").kind, "video");
assert.strictEqual(p.directFileProvider("https://example.com/download.html", "video/mp4").formats[0].ext, "mp4");
assert.strictEqual(p.directFileProvider("https://example.com/bad-%ZZ.mp4").title, "bad-%ZZ");
assert.strictEqual(p.resolveProvider("https://example.com/page").provider, "yt-dlp");
assert.strictEqual(p.cachePolicy("https://rr.example/video.mp4").cacheMediaUrl, true);
assert.strictEqual(p.cachePolicy("https://v16.cdninstagram.com/video.mp4?oe=abc&sig=xyz").cacheMediaUrl, false);
assert.strictEqual(p.cachePolicy("https://v16.cdninstagram.com/video.mp4?oe=abc&sig=xyz").refreshMediaUrl, true);
const resolver = new p.ProviderResolver();
assert.strictEqual(resolver.resolve("https://cdn.example/file.mp4").constructor.name, "DirectFileProvider");
assert.strictEqual(resolver.resolve("https://www.youtube.com/watch?v=x").constructor.name, "YTDLPProvider");

const reel = p.normalizeYTDLP({
  id: "reel", title: "Reel", uploader: "creator", duration: 0,
  requested_formats: [{ duration: 17 }], formats: [
    { height: 720, ext: "mp4", vcodec: "avc1", acodec: "mp4a", quality: 5 },
    { height: 1080, ext: "mp4", protocol: "https", fps: 30, vcodec: "avc1", acodec: "mp4a", quality: 8, format_note: "1080p" },
  ],
}, "https://www.instagram.com/reels/example/");
assert.strictEqual(reel.provider, "yt-dlp");
assert.strictEqual(reel.duration, 17);
assert.strictEqual(reel.kind, "video");
assert.strictEqual(reel.capabilities.supportsTrim, true);
assert.strictEqual(reel.formats[1].protocol, "https");
assert.strictEqual(reel.formats[1].fps, 30);
assert.strictEqual(reel.formats[1].formatNote, "1080p");
assert.strictEqual(p.chooseFormat(reel, "video").height, 1080);
assert.strictEqual(p.supportsFormat(reel, "video"), true);
assert.strictEqual(p.supportsFormat(reel, "audio"), true);

const collection = p.normalizeYTDLP({ _type: "playlist", title: "Set", entries: [{ id: "1", title: "One" }] }, "https://example.com/list");
assert.strictEqual(collection.kind, "collection");
assert.strictEqual(collection.items.length, 1);

assert.strictEqual(p.classifyProviderError("Sign in to confirm"), "authentication-required");
assert.strictEqual(p.classifyProviderError("live stream"), "active-livestream");
assert.strictEqual(p.classifyProviderError("403 expired signature"), "expired-url");
assert.strictEqual(p.classifyProviderError("403 Forbidden"), "expired-url");
assert.strictEqual(p.classifyProviderError("request blocked by website"), "source-blocked");
assert.strictEqual(p.classifyProviderError("This is a live stream"), "active-livestream");
assert.strictEqual(p.classifyProviderError("Private video: login required"), "authentication-required");
assert.strictEqual(p.classifyProviderError("ffmpeg not found"), "ffmpeg-missing");
assert.strictEqual(p.classifyProviderError("extractor failed"), "provider-failed");

console.log("provider tests: ok");
