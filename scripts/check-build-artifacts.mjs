import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function checkBuildArtifacts(options = {}) {
  const distDir = options.distDir || process.env.NEXT_DIST_DIR || ".next";
  const expectsStandalone = options.output ? options.output === "standalone" : process.env.NEXT_OUTPUT === "standalone";
  const requiredFiles = [
    "BUILD_ID",
    "required-server-files.json",
    "routes-manifest.json",
    join("server"),
    join("static")
  ];

  if (expectsStandalone) {
    requiredFiles.push(join("standalone", "server.js"));
  }

  const missing = requiredFiles.filter((file) => !existsSync(join(distDir, file)));
  const tracePath = join(distDir, "trace");
  const buildIdPath = join(distDir, "BUILD_ID");

  return {
    ok: missing.length === 0,
    distDir,
    output: expectsStandalone ? "standalone" : "standard",
    buildId: existsSync(buildIdPath) ? readFileSync(buildIdPath, "utf8").trim() : undefined,
    missing,
    hasTrace: existsSync(tracePath)
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkBuildArtifacts();
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exit(1);
  }
}
