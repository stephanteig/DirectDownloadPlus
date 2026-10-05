"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run(["test/run.js"]);
run(["--check", "main.js"]);
for (const file of fs.readdirSync(path.join(__dirname, "..", "js"))) {
  if (file.endsWith(".js")) run(["--check", path.join("js", file)]);
}
console.log("verification: ok");
