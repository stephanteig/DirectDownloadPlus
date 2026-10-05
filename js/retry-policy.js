"use strict";

const NON_RETRYABLE = new Set([
  "invalid-url", "authentication-required", "source-blocked", "expired-url",
  "ffmpeg-missing", "collection-detected", "incomplete-metadata",
]);

function retryableProviderError(error) {
  const type = typeof error === "string" ? error : error && (error.providerError || error.code || error.type);
  if (NON_RETRYABLE.has(String(type || ""))) return false;
  const text = String(error && error.message || error || "").toLowerCase();
  if (/private|login required|sign in|invalid url|unsupported format|ffmpeg.*not found/.test(text)) return false;
  return true;
}

function coordinatorError(result) {
  const error = result && result.error ? result.error : result;
  return Object.assign(new Error(String(error && error.erro || error && error.message || "provider failed")), {
    providerError: error && error.providerError,
    retryable: retryableProviderError(error),
  });
}

module.exports = { NON_RETRYABLE, retryableProviderError, coordinatorError };
