"use strict";

const assert = require("assert");
const http = require("http");
const { contentTypeForUrl } = require("../js/motor");

const server = http.createServer((request, response) => {
  if (request.method === "HEAD") {
    response.writeHead(405);
    return response.end();
  }
  assert.strictEqual(request.headers.range, "bytes=0-0");
  response.writeHead(206, { "Content-Type": "video/mp4", "Content-Range": "bytes 0-0/10" });
  response.end("x");
});

server.listen(0, "127.0.0.1", async () => {
  try {
    const address = server.address();
    const type = await contentTypeForUrl(new URL(`http://127.0.0.1:${address.port}/download.html`));
    assert.strictEqual(type, "video/mp4");
    console.log("content type probe tests: ok");
  } finally {
    server.close();
  }
});
