import { NextResponse } from "next/server";
import { assertApiAccess } from "@/lib/api-boundary";
import { detectLocalCodingAssistantStatus } from "@/lib/local-coding-assistant/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await assertApiAccess(req);
  if (auth) return auth;
  return NextResponse.json(await detectLocalCodingAssistantStatus());
}
