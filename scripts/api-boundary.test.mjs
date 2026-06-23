import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  PUBLIC_API_ROUTE_FILES,
  isPublicApiRouteFile,
  normalizeApiRouteFile,
} from "../lib/api-boundary-routes";

const ROOT = process.cwd();
const API_ROOT = path.join(ROOT, "app", "api");

function routeFiles(dir = API_ROOT) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (entry.name === "route.ts") {
      out.push(normalizeApiRouteFile(path.relative(ROOT, full)));
    }
  }
  return out.sort();
}

function sourceFor(routeFile) {
  return fs.readFileSync(path.join(ROOT, routeFile), "utf8");
}

const BOUNDARY_MARKERS = [
  "assertApiAccess(",
  "assertRemoteAuth(",
  "isLocalRequest(",
];

describe("API access boundary guardrail", () => {
  it("keeps public API exceptions explicit and narrow", () => {
    expect(PUBLIC_API_ROUTE_FILES).toEqual([
      "app/api/health/route.ts",
      "app/api/remote/ping/route.ts",
      "app/api/remote/pair/info/route.ts",
      "app/api/remote/pair/complete/route.ts",
      "app/api/auth/login/[provider]/route.ts",
    ]);
  });

  it("requires every non-public API route to declare an access boundary", () => {
    const missing = routeFiles().filter((routeFile) => {
      if (isPublicApiRouteFile(routeFile)) return false;
      const source = sourceFor(routeFile);
      return !BOUNDARY_MARKERS.some((marker) => source.includes(marker));
    });

    expect(missing).toEqual([]);
  });
});
