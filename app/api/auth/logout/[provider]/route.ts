/**
 * /api/auth/logout/[provider]
 *
 * POST  调用 AuthStorage.logout(provider) 删除凭证。
 * 等价于 DELETE /api/auth?provider=xx，单独暴露是为了和 pi-web 的路由风格对齐。
 */
import { type NextRequest, NextResponse } from "next/server";
import { assertApiAccess } from "@/lib/api-boundary";
import { getAuth, getModelRegistry } from "@/lib/agent-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ provider: string }> }
) {
  const auth = await assertApiAccess(req);
  if (auth) return auth;
  try {
    const { provider } = await ctx.params;
    if (!provider) {
      return NextResponse.json({ error: "provider required" }, { status: 400 });
    }
    const auth = getAuth();
    auth.logout(provider);
    getModelRegistry().refresh();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
