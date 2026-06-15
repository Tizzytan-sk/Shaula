/**
 * POST /api/auth/test
 *
 * body: { provider: string, modelId?: string }
 *
 * 用当前 ModelRegistry + AuthStorage 发一条最小 prompt，验证某个 provider 的凭证
 * 是否真的可调用模型。用于 AuthPanel / ProviderSetupWizard 的保存后验证。
 */
import { NextResponse, type NextRequest } from "next/server";
import { completeSimple } from "@earendil-works/pi-ai";
import { getModelRegistry } from "@/lib/agent-registry";
import { classifyProviderReadiness } from "@/lib/auth/readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface TestAuthRequest {
  provider?: string;
  modelId?: string;
}

function pickModel(provider: string, modelId?: string) {
  const mr = getModelRegistry();
  if (modelId) return mr.find(provider, modelId);
  return mr.getAll().find((m) => m.provider === provider) ?? null;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  let httpStatus: number | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as TestAuthRequest;
    const provider = body.provider?.trim();
    if (!provider) {
      const classified = classifyProviderReadiness({
        error: "provider required",
      });
      return NextResponse.json(
        { ok: false, error: "provider required", ...classified },
        { status: 400 }
      );
    }

    const model = pickModel(provider, body.modelId?.trim());
    if (!model) {
      const error = body.modelId
        ? `model not found: ${provider}/${body.modelId}`
        : `no model registered for provider: ${provider}`;
      const classified = classifyProviderReadiness({ error });
      return NextResponse.json(
        {
          ok: false,
          error,
          latencyMs: Date.now() - startedAt,
          ...classified,
        },
        { status: 404 }
      );
    }

    const mr = getModelRegistry();
    const auth = await mr.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      const error = `auth failed: ${auth.error}`;
      return NextResponse.json({
        ok: false,
        error,
        latencyMs: Date.now() - startedAt,
        ...classifyProviderReadiness({ error }),
      });
    }
    if (!auth.apiKey) {
      const error = `No API key or OAuth token found for "${provider}"`;
      return NextResponse.json({
        ok: false,
        error,
        latencyMs: Date.now() - startedAt,
        ...classifyProviderReadiness({ error }),
      });
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20_000);
    try {
      const msg = await completeSimple(
        model,
        {
          messages: [
            {
              role: "user",
              content: "Reply with OK only.",
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          maxTokens: 16,
          timeoutMs: 20_000,
          maxRetries: 0,
          cacheRetention: "none",
          signal: ac.signal,
          onResponse: (r: { status?: number }) => {
            httpStatus = r?.status;
          },
        }
      );
      const latencyMs = Date.now() - startedAt;
      if (msg.stopReason === "error" || msg.stopReason === "aborted") {
        const error =
          msg.errorMessage ??
          (ac.signal.aborted ? "Test timed out" : "Model returned an error");
        return NextResponse.json({
          ok: false,
          error,
          latencyMs,
          status: httpStatus,
          model: { provider: model.provider, id: model.id, name: model.name },
          ...classifyProviderReadiness({ error, status: httpStatus }),
        });
      }
      return NextResponse.json({
        ok: true,
        latencyMs,
        status: httpStatus,
        model: { provider: model.provider, id: model.id, name: model.name },
        ...classifyProviderReadiness({ ok: true, status: httpStatus }),
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        ok: false,
        error,
        latencyMs: Date.now() - startedAt,
        status: httpStatus,
        ...classifyProviderReadiness({ error, status: httpStatus }),
      },
      { status: 500 }
    );
  }
}
