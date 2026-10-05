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
const MIME_EXTENSIONS = new Map([
  ["video/mp4", "mp4"], ["video/quicktime", "mov"], ["video/webm", "webm"],
  ["audio/mpeg", "mp3"], ["audio/mp4", "m4a"], ["audio/x-m4a", "m4a"],
  ["audio/wav", "wav"], ["audio/x-wav", "wav"], ["audio/flac", "flac"],
]);

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

function supportsFormat(metadata, requested) {
  const caps = metadata && metadata.capabilities || {};
  const format = String(requested || "").toLowerCase();
  if (!format) return false;
  if (format === "video") return !!caps.supportsVideo;
  if (format === "audio") return !!caps.supportsAudio;
  return Array.isArray(metadata && metadata.formats)
    && metadata.formats.some((item) => String(item && item.ext || "").toLowerCase() === format);
}

function chooseFormat(metadata, requested) {
  if (!supportsFormat(metadata, requested)) return null;
  const wanted = String(requested).toLowerCase();
  const formats = Array.isArray(metadata.formats) ? metadata.formats : [];
  if (["video", "audio"].includes(wanted)) return formats[0] || { id: wanted, ext: wanted };
  return formats.find((item) => String(item && item.ext || "").toLowerCase() === wanted)
    || { id: wanted, ext: wanted };
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

function directFileProvider(value, contentType = "") {
  const url = validHttpUrl(value);
  const mime = String(contentType || "").split(";", 1)[0].trim().toLowerCase();
  const ext = extensionOf(value) || MIME_EXTENSIONS.get(mime) || "";
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

function isSignedMediaUrl(value) {
  const u = validHttpUrl(value);
  if (!u) return false;
  const query = u.search.toLowerCase();
  return /(^|[?&])(token|sig|signature|expires|expire|oe|oh|range|bytestart|byteend|lsig)=/.test(query)
    || /googlevideo\.com|cdninstagram\.com|fbcdn\.net|akamaized\.net/.test(u.hostname);
}

function cachePolicy(sourceUrl, metadata = {}) {
  const signed = isSignedMediaUrl(sourceUrl);
  return {
    cacheMetadata: true,
    cacheMediaUrl: !signed,
    mediaUrlTtlMs: signed ? 0 : (Number(metadata.mediaUrlTtlMs) || 2 * 60 * 60 * 1000),
    refreshMediaUrl: signed,
  };
}

class DirectFileProvider {
  canHandle(url) { return !!directFileProvider(url); }
  inspect(url) { return directFileProvider(url); }
}

class YTDLPProvider {
  canHandle(url) { return !!validHttpUrl(url) && !directFileProvider(url); }
  normalize(json, sourceUrl) { return normalizeYTDLP(json, sourceUrl); }
}

class ProviderResolver {
  constructor() {
    this.providers = [new DirectFileProvider(), new YTDLPProvider()];
  }
  resolve(url) {
    for (const provider of this.providers) {
      if (provider.canHandle(url)) return provider;
    }
    return null;
  }
}

function classifyProviderError(raw) {
  const text = String(raw || "");
  if (/live|livestream|is_live/i.test(text)) return "active-livestream";
  if (/private|login required|sign in|authentication/i.test(text)) return "authentication-required";
  if (/expired|signature|signed url|url.*expir|token.*expir|(^|[^0-9])403([^0-9]|$)/i.test(text)) return "expired-url";
  if (/forbidden|blocked|denied/i.test(text)) return "source-blocked";
  if (/ffmpeg.*(not found|missing)|no such file.*ffmpeg/i.test(text)) return "ffmpeg-missing";
  return "provider-failed";
}

module.exports = {
  DIRECT_EXTENSIONS,
  MIME_EXTENSIONS,
  validHttpUrl,
  extensionOf,
  capabilitiesFor,
  supportsFormat,
  chooseFormat,
  durationFrom,
  normalizeYTDLP,
  directFileProvider,
  resolveProvider,
  isSignedMediaUrl,
  cachePolicy,
  DirectFileProvider,
  YTDLPProvider,
  ProviderResolver,
  classifyProviderError,
};
