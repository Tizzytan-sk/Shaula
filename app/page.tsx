import ChatApp from "./ChatApp";
import { listAllSessions } from "@/lib/sessions";
import { ensureLongTaskScheduler } from "@/lib/tasks/scheduler";
import { getShaulaWebRoot } from "@/lib/shaula-paths";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // E2E 模式:跳过 server-side 真实 sessions / cwd 读取,让 client 端 mock 接管
  const sp = await searchParams;
  if (sp?.e2e === "1") {
    return <ChatApp initialSessions={[]} defaultCwd="/tmp/e2e-cwd" />;
  }

  ensureLongTaskScheduler();
  const sessions = await listAllSessions();
  // Electron 打包后 process.cwd() 不是用户期待的家目录；优先用 SHAULA_WEB_ROOT。
  const cwd = getShaulaWebRoot() || process.cwd();
  return (
    <ChatApp
      initialSessions={sessions.map((s) => ({
        id: s.id,
        path: s.path,
        cwd: s.cwd,
        name: s.name,
        parentSessionPath: s.parentSessionPath,
        created: s.created.toISOString(),
        modified: s.modified.toISOString(),
        messageCount: s.messageCount,
        firstMessage: s.firstMessage,
        isRunning: s.isRunning,
      }))}
      defaultCwd={cwd}
    />
  );
}
