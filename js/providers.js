"use strict";

/* Provider boundary for Direct Download Plus.
 * Providers return normalized metadata; app.js may continue consuming the
 * legacy fields until each UI path has been migrated and regression-tested.
 */

const DIRECT_EXTENSIONS = new Set([
  "mp4", "mov", "m4v", "webm", "mp3", "m4a", "wav", "flac",
]);

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "wav", "flac"]);

function validHttpUrl(value) {
  try {
    const u = new URL(String(value || ""));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch (_) {
    return null;
  }
}

function extensionOf(value) {
  const u = validHttpUrl(value);
  if (!u) return "";
  const last = u.pathname.split("/").pop() || "";
  const dot = last.lastIndexOf(".");
  return dot < 0 ? "" : last.slice(dot + 1).toLowerCase();
}

function capabilitiesFor(kind, durationKnown) {
  const isVideo = kind === "video";
  const isAudio = kind === "audio";
  return {
    supportsVideo: isVideo,
    supportsAudio: isVideo || isAudio,
    supportsTrim: !!durationKnown,
    supportsThumbnail: isVideo,
    supportsMetadata: true,
    supportsCollections: false,
    supportsItemSelection: false,
  };
}

function durationFrom(value) {
  const finitePositive = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const direct = finitePositive(value && value.duration);
  if (direct) return direct;
  const requested = value && Array.isArray(value.requested_formats)
    ? value.requested_formats : [];
  const requestedDuration = requested.reduce((best, item) => Math.max(best, finitePositive(item && item.duration)), 0);
  if (requestedDuration) return requestedDuration;
  const formats = value && Array.isArray(value.formats) ? value.formats : [];
  const formatDuration = formats.reduce((best, item) => Math.max(best, finitePositive(item && (item.duration || item.duration_s))), 0);
  if (formatDuration) return formatDuration;
  return finitePositive(value && value.duration_s);
}

function normalizeYTDLP(json, sourceUrl) {
  const j = json && typeof json === "object" ? json : {};
  const duration = durationFrom(j);
  const entries = Array.isArray(j.entries) ? j.entries.filter(Boolean) : [];
  const rawFormats = Array.isArray(j.formats) ? j.formats : [];
  const hasVideo = !!j.vcodec || !!j.video_ext || rawFormats.some((f) => f && (f.vcodec && f.vcodec !== "none" || Number(f.height) > 0));
  const kind = entries.length || j._type === "playlist" ? "collection" : (hasVideo ? "video" : "audio");
  const formats = rawFormats.map((f) => ({
    id: f.format_id || "",
    ext: f.ext || "",
    height: Number(f.height) || 0,
    width: Number(f.width) || 0,
    acodec: f.acodec || "",
    vcodec: f.vcodec || "",
    filesize: Number(f.filesize || f.filesize_approx) || 0,
  }));
  return {
    provider: "yt-dlp",
    kind,
    title: j.title || j.id || "Download",
    author: j.uploader || j.channel || j.creator || "",
    duration,
    thumbnail: j.thumbnail || "",
    sourceUrl: String(sourceUrl || j.webpage_url || j.original_url || ""),
    items: entries.map((entry) => normalizeYTDLP(entry, entry.webpage_url || sourceUrl)),
    formats,
    capabilities: capabilitiesFor(kind, duration > 0),
    liveStatus: j.live_status || (j.is_live ? "is_live" : "not_live"),
    metadataComplete: !!(j.id || j.title),
  };
}

function directFileProvider(value) {
  const url = validHttpUrl(value);
  const ext = extensionOf(value);
  if (!url || !DIRECT_EXTENSIONS.has(ext)) return null;
  const kind = VIDEO_EXTENSIONS.has(ext) ? "video" : "audio";
  return {
    provider: "direct-file",
    kind,
    title: decodeURIComponent((url.pathname.split("/").pop() || "Download").replace(/\.[^.]+$/, "")),
    author: "",
    duration: 0,
    thumbnail: "",
    sourceUrl: url.href,
    items: [],
    formats: [{ id: ext, ext, direct: true }],
    capabilities: capabilitiesFor(kind, false),
    metadataComplete: true,
    direct: true,
  };
}

function resolveProvider(value) {
  const direct = directFileProvider(value);
  return direct || {
    provider: "yt-dlp",
    sourceUrl: String(value || ""),
    reason: "generic-extractor-fallback",
  };
}

function classifyProviderError(raw) {
  const text = String(raw || "");
  if (/live|livestream|is_live/i.test(text)) return "active-livestream";
  if (/private|login required|sign in|authentication/i.test(text)) return "authentication-required";
  if (/forbidden|blocked|denied|403/i.test(text)) return "source-blocked";
  if (/expired|signature|url.*expire|403/i.test(text)) return "expired-url";
  if (/ffmpeg.*(not found|missing)|no such file.*ffmpeg/i.test(text)) return "ffmpeg-missing";
  return "provider-failed";
}

module.exports = {
  DIRECT_EXTENSIONS,
  validHttpUrl,
  extensionOf,
  durationFrom,
  normalizeYTDLP,
  directFileProvider,
  resolveProvider,
  classifyProviderError,
};
