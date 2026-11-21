#!/usr/bin/env node
// Runs by itself after `npm i`: installs the engine's Python packages so `npm run dev` is all that's left.
// Never fails the install: if Python is missing, the app's first screen says what to install.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const localEnv = path.join(root, ".env.local");
const say = (m) => console.log(`[moments] ${m}`);
const version = (cmd, args = ["--version"]) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
};

const python = ["python", "python3", "py"].find((p) => /Python 3\.(1[0-9])/.test(version(p) ?? ""));
if (!python) {
  say("Python 3.10+ not found. Install it (https://www.python.org/downloads), then run npm i again.");
  process.exit(0);
}
say(`Installing the Python packages with ${version(python)}…`);
const pip = spawnSync(python, ["-m", "pip", "install", "--disable-pip-version-check", "-q", "-r", path.join(root, "engine", "requirements.txt")], { stdio: "inherit" });
if (pip.status !== 0) {
  say(`pip couldn't install the packages. Try: ${python} -m pip install -r engine/requirements.txt`);
  process.exit(0);
}
if (python !== "python") {
  // The app starts the engine with this command.
  const lines = existsSync(localEnv) ? readFileSync(localEnv, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("PYTHON=")) : [];
  writeFileSync(localEnv, [...lines, `PYTHON=${python}`].join("\n") + "\n");
}
if (!version("ffmpeg", ["-version"])) say("ffmpeg not found. Install it (https://ffmpeg.org/download.html) and open a new terminal.");
say("Ready. Start the app with: npm run dev");
