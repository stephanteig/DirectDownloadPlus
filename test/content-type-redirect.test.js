"use strict";

const assert = require("assert");
const http = require("http");
const { contentTypeForUrl } = require("../js/motor");

const server = http.createServer((request, response) => {
  if (request.url === "/redirect") {
    response.writeHead(302, { Location: "/file.mp4" });
    return response.end();
  }
  response.writeHead(200, { "Content-Type": "video/mp4" });
  response.end();
});

server.listen(0, "127.0.0.1", async () => {
  try {
    const { port } = server.address();
    assert.strictEqual(await contentTypeForUrl(new URL(`http://127.0.0.1:${port}/redirect`)), "video/mp4");
    console.log("content type redirect tests: ok");
  } finally {
    server.close();
  }
});
