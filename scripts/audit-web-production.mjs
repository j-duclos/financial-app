#!/usr/bin/env node
/**
 * Fail CI on high/critical vulnerabilities in @budget-app/web production deps.
 *
 * `npm audit -w` still reports Expo/mobile toolchain packages hoisted in the
 * workspace lockfile (metro/babel). Those are not web production runtime deps.
 */
import { execSync } from "node:child_process";

const WEB_WORKSPACE = "@budget-app/web";

function run(command) {
  try {
    return execSync(command, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    if (err && typeof err === "object" && "stdout" in err && err.stdout) {
      return String(err.stdout);
    }
    throw err;
  }
}

function productionPackageNames() {
  const output = run(`npm ls --omit=dev -w ${WEB_WORKSPACE} --all --parseable`);
  const names = new Set();
  for (const line of output.split(/\r?\n/)) {
    const normalized = line.replace(/\\/g, "/").trim();
    if (!normalized) continue;
    const match = normalized.match(/node_modules\/((?:@[^/]+\/)?[^/]+)$/);
    if (match) names.add(match[1]);
  }
  names.add(WEB_WORKSPACE);
  names.add("@budget-app/api-client");
  names.add("@budget-app/shared");
  return names;
}

function auditReport() {
  const raw = run(`npm audit --omit=dev --json -w ${WEB_WORKSPACE}`);
  return JSON.parse(raw);
}

const prod = productionPackageNames();
const report = auditReport();
const blocking = [];

for (const [name, info] of Object.entries(report.vulnerabilities ?? {})) {
  const severity = info?.severity;
  if (severity !== "high" && severity !== "critical") continue;
  if (!prod.has(name)) continue;
  blocking.push(`${name} (${severity})`);
}

if (blocking.length) {
  console.error(
    `High/critical vulnerabilities in ${WEB_WORKSPACE} production dependencies:\n` +
      blocking.map((item) => ` - ${item}`).join("\n")
  );
  process.exit(1);
}

console.log(
  `No high/critical vulnerabilities in ${WEB_WORKSPACE} production dependencies (${prod.size} packages).`
);
