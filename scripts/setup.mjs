#!/usr/bin/env node
// One-time setup for Moments: checks the tools, installs the Python packages, asks for the free API key, builds the app.
// Run with:  npm run setup        (safe to run again; it keeps keys you already entered)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, platform } from "node:process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const envFile = path.join(root, "engine", ".env");
const localEnv = path.join(root, ".env.local");
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const step = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

function version(cmd, args = ["--version"]) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\n")[0].trim();
  } catch {
    return null;
  }
}

console.log("\n\x1b[1mMoments setup\x1b[0m: free AI clipper for long gaming streams\n");

// 1. Tools
step("1. Checking the tools");
let problems = 0;
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor >= 20) ok(`Node.js ${process.versions.node}`);
else { bad(`Node.js ${process.versions.node}: version 20 or newer needed (https://nodejs.org)`); problems++; }

const python = ["python", "python3", "py"].find((p) => /Python 3\.(1[0-9])/.test(version(p) ?? ""));
if (python) ok(`${version(python)} (${python})`);
else {
  bad("Python 3.10 or newer not found. Windows: winget install Python.Python.3.12   macOS: brew install python   Linux: sudo apt install python3 python3-pip");
  problems++;
}

const ff = version("ffmpeg", ["-version"]);
if (ff) ok(ff.split(" Copyright")[0]);
else {
  bad("ffmpeg not found. Windows: winget install Gyan.FFmpeg   macOS: brew install ffmpeg   Linux: sudo apt install ffmpeg  (then open a NEW terminal)");
  problems++;
}
if (problems) {
  console.log("\nInstall what is missing, open a new terminal, and run  npm run setup  again.\n");
  process.exit(1);
}

// 2. Python packages
step("2. Installing the Python packages (yt-dlp, OpenCV, numpy, requests)");
const pip = spawnSync(python, ["-m", "pip", "install", "--upgrade", "-r", path.join(root, "engine", "requirements.txt")], { stdio: "inherit" });
if (pip.status !== 0) {
  bad("pip could not install the packages. Try:  " + python + " -m pip install -r engine/requirements.txt");
  process.exit(1);
}
ok("Python packages ready");
if (python !== "python") {
  // The app starts the engine with this command.
  const lines = existsSync(localEnv) ? readFileSync(localEnv, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("PYTHON=")) : [];
  writeFileSync(localEnv, [...lines, `PYTHON=${python}`].join("\n") + "\n");
  ok(`The app will use "${python}" (saved in .env.local)`);
}

// 3. Keys
step("3. API keys (stored only on this PC, in engine/.env)");
const env = existsSync(envFile) ? Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])) : {};
// Answers are read line by line: works when typed, pasted or piped, and an empty line keeps the current value.
const rl = createInterface({ input: stdin, terminal: false });
const lines = rl[Symbol.asyncIterator]();
async function ask(name, what, required) {
  if (env[name]) ok(`${name} already set (press Enter to keep it)`);
  console.log(`  ${what}`);
  stdout.write(`  ${name}${env[name] ? " [keep]" : required ? "" : " [skip]"}: `);
  const next = await lines.next();
  const v = (next.done ? "" : String(next.value)).trim();
  if (next.done) stdout.write("\n");
  if (v) env[name] = v;
  if (required && !env[name]) {
    bad(`${name} is needed. Run  npm run setup  again when you have it.`);
    process.exit(1);
  }
}
await ask("GROQ_API_KEY", "Free key for speech-to-text and the AI picker: https://console.groq.com/keys (sign in, Create API Key)", true);
await ask("ANTHROPIC_API_KEY", "Optional, paid: Claude picks better moments and writes better titles. https://console.anthropic.com  (Enter = skip, Groq is used)", false);
rl.close();
mkdirSync(path.dirname(envFile), { recursive: true });
writeFileSync(envFile, "# API keys: stay on this PC only (git ignores this file)\n" + Object.entries(env).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
ok("Keys saved");

// 4. Build
step("4. Building the app (about a minute)");
const npm = platform === "win32" ? "npm.cmd" : "npm";
if (!existsSync(path.join(root, "node_modules"))) spawnSync(npm, ["install"], { cwd: root, stdio: "inherit", shell: platform === "win32" });
const build = spawnSync(npm, ["run", "build"], { cwd: root, stdio: "inherit", shell: platform === "win32" });
if (build.status !== 0) {
  bad("The build failed; the message above says why.");
  process.exit(1);
}
ok("App built");

console.log("\n\x1b[1mAll set.\x1b[0m Start it with:\n\n  npm start\n\nthen open http://127.0.0.1:3000\n");
