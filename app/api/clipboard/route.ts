import { NextResponse } from "next/server";
import { assertApiAccess } from "@/lib/api-boundary";
import { writeClipboardText } from "@/lib/clipboard/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await assertApiAccess(req);
  if (auth) return auth;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = body.text as string | undefined;
  try {
    const result = await writeClipboardText(text ?? "");
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
