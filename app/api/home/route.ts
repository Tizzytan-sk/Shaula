/**
 * GET /api/home → 用户 home 目录，给文件 picker 当起点。
 */
import { NextResponse } from "next/server";
import { homedir } from "node:os";
import { assertApiAccess } from "@/lib/api-boundary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await assertApiAccess(req);
  if (auth) return auth;
  return NextResponse.json({ home: homedir() });
}
