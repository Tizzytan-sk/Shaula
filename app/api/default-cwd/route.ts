/**
 * GET /api/default-cwd → 服务器进程的 cwd，作为新会话默认目录。
 *
 * 复刻 pi-web 的 /api/default-cwd。
 */
import { NextResponse } from "next/server";
import { assertRemoteAuth } from "@/lib/remote/auth";
import { getShaulaWebRoot } from "@/lib/shaula-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await assertRemoteAuth(req);
  if (auth) return auth;
  // Electron 下 process.cwd() 不是用户期待的家目录；优先用 SHAULA_WEB_ROOT。
  return NextResponse.json({ cwd: getShaulaWebRoot() || process.cwd() });
}
