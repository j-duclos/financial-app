/**
 * react-plaid-link omits receivedRedirectUri from usePlaidLink's effect deps, so Plaid.create
 * never sees OAuth return. Re-apply after every npm install.
 * Upstream: https://github.com/plaid/react-plaid-link/issues (same root cause as Chase "internal error")
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const files = [
  "node_modules/react-plaid-link/dist/index.esm.js",
  "node_modules/react-plaid-link/dist/index.js",
  "node_modules/react-plaid-link/dist/index.umd.js",
];

const needle = "[loading, error, options.publicKey, options.token, products]";
const replacement = "[loading, error, options.publicKey, options.token, options.receivedRedirectUri, products]";

for (const rel of files) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) continue;
  let s = fs.readFileSync(abs, "utf8");
  if (s.includes(replacement)) continue;
  if (!s.includes(needle)) {
    console.warn(`patch-react-plaid-link: pattern not found in ${rel}, skip`);
    continue;
  }
  fs.writeFileSync(abs, s.split(needle).join(replacement), "utf8");
  console.log(`patch-react-plaid-link: patched ${rel}`);
}
