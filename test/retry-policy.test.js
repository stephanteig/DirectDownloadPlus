"use strict";

const assert = require("assert");
const { retryableProviderError, coordinatorError } = require("../js/retry-policy");

assert.strictEqual(retryableProviderError({ providerError: "invalid-url" }), false);
assert.strictEqual(retryableProviderError({ providerError: "authentication-required" }), false);
assert.strictEqual(retryableProviderError({ providerError: "provider-failed" }), true);
assert.strictEqual(retryableProviderError(new Error("temporary network timeout")), true);
assert.strictEqual(coordinatorError({ erro: "private video", providerError: "authentication-required" }).retryable, false);
console.log("retry policy tests: ok");
