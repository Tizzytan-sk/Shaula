import "server-only";
import type { NextResponse } from "next/server";
import { assertRemoteAuth } from "@/lib/remote/auth";
export {
  PUBLIC_API_ROUTE_FILES,
  isPublicApiRouteFile,
  normalizeApiRouteFile,
} from "@/lib/api-boundary-routes";

/**
 * Central API boundary for local high-privilege routes.
 *
 * Local browser/dev requests are allowed by assertRemoteAuth. Electron requests
 * are allowed through the x-shaula-local-secret header injected by the main
 * process. Remote/mobile requests require an authorized remote token unless the
 * route is explicitly listed as a public pairing/health endpoint.
 */
export async function assertApiAccess(
  req: Request
): Promise<NextResponse | null> {
  return assertRemoteAuth(req);
}
