import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";

const root = process.cwd();
const args = new Map(
  process.argv
    .slice(2)
    .map((arg) => {
      const [key, ...rest] = arg.split("=");
      return [key, rest.length ? rest.join("=") : "1"];
    })
);

const targets = [
  [".next/static", "Next static assets"],
  [".next/server", "Next server output"],
  [".next/standalone", "Next standalone output"],
  ["public", "Public assets"],
  ["dist", "Electron build output"],
];

function readPackageJson() {
  try {
    return JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

const packageJson = readPackageJson();
const electronFiles = Array.isArray(packageJson?.build?.files)
  ? packageJson.build.files.map((item) => String(item).replaceAll("\\", "/"))
  : [];

function walk(dir) {
  const entries = [];
  if (!existsSync(dir)) return entries;
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      entries.push(...walk(path));
    } else if (stat.isFile()) {
      entries.push({ path, size: stat.size });
    }
  }
  return entries;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units.shift();
  while (value >= 1024 && units.length) {
    value /= 1024;
    unit = units.shift();
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function summarizeTarget([target, label]) {
  const abs = resolve(root, target);
  const files = walk(abs).map((file) => ({
    ...file,
    relativePath: relative(root, file.path).split(sep).join("/"),
  }));
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  return {
    target,
    label,
    exists: existsSync(abs),
    fileCount: files.length,
    totalBytes,
    largestFiles: [...files].sort((a, b) => b.size - a.size).slice(0, 12),
  };
}

function summarizeStaticBuckets() {
  const prefix = ".next/static/";
  const buckets = new Map();
  for (const file of walk(resolve(root, ".next/static"))) {
    const rel = relative(root, file.path).split(sep).join("/");
    const withoutPrefix = rel.startsWith(prefix) ? rel.slice(prefix.length) : rel;
    const bucket = withoutPrefix.split("/")[0] || "(root)";
    buckets.set(bucket, (buckets.get(bucket) || 0) + file.size);
  }
  return [...buckets.entries()]
    .map(([bucket, totalBytes]) => ({ bucket, totalBytes }))
    .sort((a, b) => b.totalBytes - a.totalBytes);
}

function summarizeBucket(target, bucketOf) {
  const buckets = new Map();
  const prefix = `${target.replaceAll("\\", "/").replace(/\/$/, "")}/`;
  for (const file of walk(resolve(root, target))) {
    const rel = relative(root, file.path).split(sep).join("/");
    const withoutPrefix = rel.startsWith(prefix) ? rel.slice(prefix.length) : rel;
    const bucket = bucketOf(withoutPrefix, rel);
    buckets.set(bucket, (buckets.get(bucket) || 0) + file.size);
  }
  return [...buckets.entries()]
    .map(([bucket, totalBytes]) => ({ bucket, totalBytes }))
    .sort((a, b) => b.totalBytes - a.totalBytes);
}

function targetBytes(target) {
  return walk(resolve(root, target)).reduce((sum, file) => sum + file.size, 0);
}

function isIncludedInElectronFiles(target) {
  const normalized = target.replaceAll("\\", "/").replace(/\/$/, "");
  for (const pattern of electronFiles) {
    if (pattern.startsWith("!")) continue;
    const cleanPattern = pattern.replace(/\/$/, "");
    if (cleanPattern === normalized) return true;
    if (cleanPattern === `${normalized}/**/*`) return true;
    if (cleanPattern.endsWith("/**/*")) {
      const prefix = cleanPattern.slice(0, -"/**/*".length);
      if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
        return true;
      }
    }
    if (cleanPattern.endsWith("/**")) {
      const prefix = cleanPattern.slice(0, -"/**".length);
      if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
        return true;
      }
    }
  }
  return false;
}

function duplicateCandidate(source, bundled, label) {
  const sourceExists = existsSync(resolve(root, source));
  const bundledExists = existsSync(resolve(root, bundled));
  const sourceBytes = sourceExists ? targetBytes(source) : 0;
  const bundledBytes = bundledExists ? targetBytes(bundled) : 0;
  const sourceIncludedInElectron = isIncludedInElectronFiles(source);
  const bundledIncludedInElectron = isIncludedInElectronFiles(bundled);
  return {
    label,
    source,
    bundled,
    sourceExists,
    bundledExists,
    sourceIncludedInElectron,
    bundledIncludedInElectron,
    sourceBytes,
    bundledBytes,
    possibleDuplicateBytes:
      sourceExists &&
      bundledExists &&
      sourceIncludedInElectron &&
      bundledIncludedInElectron
        ? Math.min(sourceBytes, bundledBytes)
        : 0,
  };
}

function summarizeElectronArtifacts() {
  const files = walk(resolve(root, "dist")).map((file) => ({
    ...file,
    relativePath: relative(root, file.path).split(sep).join("/"),
  }));
  const artifactBuckets = new Map([
    ["installer", 0],
    ["asar", 0],
    ["asar-unpacked", 0],
    ["resources", 0],
    ["other", 0],
  ]);

  for (const file of files) {
    const rel = file.relativePath;
    const lower = rel.toLowerCase();
    let bucket = "other";
    if (/\.(exe|dmg|zip|msi|pkg|appimage|deb|rpm)$/i.test(extname(rel))) {
      bucket = "installer";
    } else if (lower.endsWith(".asar")) {
      bucket = "asar";
    } else if (lower.includes(".asar.unpacked/")) {
      bucket = "asar-unpacked";
    } else if (lower.includes("/resources/")) {
      bucket = "resources";
    }
    artifactBuckets.set(bucket, (artifactBuckets.get(bucket) ?? 0) + file.size);
  }

  return [...artifactBuckets.entries()]
    .map(([bucket, totalBytes]) => ({ bucket, totalBytes }))
    .filter((item) => item.totalBytes > 0);
}

function summarizeElectronReview() {
  const distBuckets = existsSync(resolve(root, "dist"))
    ? summarizeBucket("dist", (withoutPrefix) => {
        const parts = withoutPrefix.split("/");
        if (parts.length === 1) return "(dist root)";
        if (parts[1] === "resources") return `${parts[0]}/resources`;
        return parts[0] || "(dist root)";
      })
    : [];
  return {
    distBuckets,
    artifactBuckets: summarizeElectronArtifacts(),
    duplicateCandidates: [
      duplicateCandidate(
        ".next/static",
        ".next/standalone/.next/static",
        "Next static copied into standalone"
      ),
      duplicateCandidate(
        "public",
        ".next/standalone/public",
        "Public assets copied into standalone"
      ),
    ],
  };
}

const summaries = targets.map(summarizeTarget);
const staticSummary = summaries.find((item) => item.target === ".next/static");
const result = {
  generatedAt: new Date().toISOString(),
  root,
  summaries,
  staticBuckets: staticSummary ? summarizeStaticBuckets() : [],
  electronReview: summarizeElectronReview(),
};

if (args.has("--json")) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

console.log("Build size summary");
console.log("==================");
for (const summary of summaries) {
  const status = summary.exists ? "ok" : "missing";
  console.log(
    `${summary.target.padEnd(18)} ${status.padEnd(7)} ${String(
      summary.fileCount
    ).padStart(5)} files  ${formatBytes(summary.totalBytes).padStart(10)}`
  );
}

if (result.staticBuckets.length) {
  console.log("\n.next/static buckets");
  for (const bucket of result.staticBuckets) {
    console.log(
      `- ${bucket.bucket.padEnd(14)} ${formatBytes(bucket.totalBytes)}`
    );
  }
}

const duplicateCandidates = result.electronReview.duplicateCandidates.filter(
  (item) => item.sourceExists || item.bundledExists
);
if (
  result.electronReview.distBuckets.length ||
  result.electronReview.artifactBuckets.length ||
  duplicateCandidates.length
) {
  console.log("\nElectron package review");
  if (result.electronReview.distBuckets.length) {
    console.log("- dist buckets");
    for (const bucket of result.electronReview.distBuckets) {
      console.log(
        `  - ${bucket.bucket.padEnd(24)} ${formatBytes(bucket.totalBytes)}`
      );
    }
  }
  if (result.electronReview.artifactBuckets.length) {
    console.log("- artifact classes");
    for (const bucket of result.electronReview.artifactBuckets) {
      console.log(
        `  - ${bucket.bucket.padEnd(14)} ${formatBytes(bucket.totalBytes)}`
      );
    }
  }
  if (duplicateCandidates.length) {
    console.log("- standalone duplicate candidates");
    for (const item of duplicateCandidates) {
      const status =
        item.possibleDuplicateBytes > 0
          ? `possible duplicate ${formatBytes(item.possibleDuplicateBytes)}`
          : item.sourceExists && !item.sourceIncludedInElectron
            ? "source exists, not packaged"
            : item.sourceExists
            ? "source only"
            : item.bundledExists
              ? "bundled only"
              : "missing";
      console.log(`  - ${item.label}: ${status}`);
      console.log(
        `    ${item.source}: ${formatBytes(item.sourceBytes)} (${item.sourceIncludedInElectron ? "packaged" : "not packaged"}); ${item.bundled}: ${formatBytes(item.bundledBytes)} (${item.bundledIncludedInElectron ? "packaged" : "not packaged"})`
      );
    }
  }
}

console.log("\nLargest build files");
for (const summary of summaries.filter((item) => item.exists)) {
  console.log(`\n${summary.target}`);
  for (const file of summary.largestFiles) {
    console.log(
      `- ${formatBytes(file.size).padStart(9)}  ${file.relativePath}`
    );
  }
}
