/**
 * Optional: generate TypeScript client from OpenAPI schema.
 * Run backend first, then: npm run generate
 * Or pass schema file: node scripts/generate.js path/to/schema.yaml
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const SCHEMA_URL = "http://localhost:8000/api/schema/?format=openapi-json";
const OUT_DIR = path.join(__dirname, "..", "src", "generated");

function fetchSchema() {
  return new Promise((resolve, reject) => {
    http.get(SCHEMA_URL, (res) => {
      let data = "";
      res.on("data", (ch) => (data += ch));
      res.on("end", () => {
        if (res.statusCode !== 200) reject(new Error(`Schema fetch failed: ${res.statusCode}`));
        else resolve(JSON.parse(data));
      });
    }).on("error", reject);
  });
}

async function main() {
  const schemaPath = process.argv[2];
  let schema;
  if (schemaPath && fs.existsSync(schemaPath)) {
    schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  } else {
    try {
      schema = await fetchSchema();
    } catch (e) {
      console.warn("Could not fetch schema from backend. Using manual client only.");
      process.exit(0);
    }
  }
  const tmpFile = path.join(__dirname, "..", "schema.tmp.json");
  fs.writeFileSync(tmpFile, JSON.stringify(schema));
  try {
    execSync(`npx openapi-typescript-codegen --input ${tmpFile} --output ${OUT_DIR} --client fetch`, {
      stdio: "inherit",
    });
    console.log("Generated client in src/generated");
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
