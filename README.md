# Shaula Agent

Shaula Agent is a local-first workbench for running coding agents, managing model
access, and driving tasks to evidence-backed completion.

It builds on [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
and runs either as a self-hosted Next.js web app or as an Electron desktop app.
Credentials stay on your machine, and Shaula-owned state is stored under
`~/.shaula/`.

Repository: <https://github.com/Tizzytan-sk/Shaula>

## Highlights

- Local web UI for agent sessions, files, tools, goals, and task runs.
- Provider setup for API-key and OAuth based model access.
- `models.json` editor for custom providers and per-model settings.
- Goal and evidence surfaces for task completion checks.
- Dynamic workflow harness with checkpoints, artifacts, resume, and templates.
- Skill evaluation harness for agent behavior checks.
- Electron desktop build with tray integration and installer workflows.
- Project memory through `AGENTS.md` / `CLAUDE.md` files loaded by the upstream SDK.

## Quick Start From Source

```bash
git clone https://github.com/Tizzytan-sk/Shaula.git
cd Shaula
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

## npm Package

```bash
npx shaula-agent
```

Then open:

```text
http://localhost:30142
```

Useful options:

```bash
npx shaula-agent -p 4000
npx shaula-agent -H 0.0.0.0
npx shaula-agent doctor
```

## Configuration

Shaula reads upstream SDK credentials from `~/.pi/` and writes Shaula-owned app
state to `~/.shaula/`.

| Path | Purpose |
|---|---|
| `~/.pi/auth.json` | API keys and OAuth credentials |
| `~/.pi/models.json` | Custom providers and model settings |
| `~/.pi/agent/skills/` | Installed agent skills |
| `~/.pi/agent/browser-sites.json` | Browser-use site allow/deny policy |
| `~/.shaula/settings.json` | UI, approval, and budget preferences |
| `~/.shaula/sessions/` | Session metadata |
| `~/.shaula/goals/` | Goal state and evidence history |
| `~/.shaula/subagents/` | Subagent definitions and memory |
| `~/.shaula/mcp/servers.json` | Configured MCP servers |
| `~/.shaula/workflows/` | Workflow runs, templates, and network policy |

Shaula does not silently migrate old product-specific state paths. If local data
needs to move into Shaula, run an explicit migration step.

### Environment Variables

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `30142` | Server port |
| `HOSTNAME` | unset | Bind host |
| `SHAULA_HOME` | `~/.shaula` | Shaula app-state root |
| `SHAULA_WEB_ROOT` | `$HOME` | File picker and cwd sandbox root |
| `SHAULA_UPDATE_OWNER` | `Tizzytan-sk` | GitHub owner for desktop update checks |
| `SHAULA_UPDATE_REPO` | `Shaula` | GitHub repo for desktop update checks |
| `BROWSER=none` | unset | Disable browser auto-open on start |

## Development

Requirements:

- Node.js 22 or newer
- npm

Install and run:

```bash
npm install
npm run dev
```

Common checks:

```bash
npm run typecheck
npm run lint
npm test
npm run perf:size
```

Production web run:

```bash
npm run build
npm start
```

## Desktop Builds

Electron development:

```bash
npm run electron:dev
```

Build installers:

```bash
# macOS arm64 DMG
npm run electron:build:mac

# Windows x64 NSIS installer
npm run electron:build:win
```

Unsigned Windows builds can trigger Microsoft Defender SmartScreen. For public
distribution, build in GitHub Actions and add Windows code signing when ready.

Desktop installer artifacts are built and uploaded through:

```text
.github/workflows/release-installers.yml
```

Create a GitHub release tag first, then run the workflow with that tag.

## Project Memory

Shaula inherits the SDK's project-memory behavior. Put an `AGENTS.md` or
`CLAUDE.md` file in a project root or ancestor directory to provide local
instructions for agent runs in that project.

See:

- [docs/guides/project-memory.md](./docs/guides/project-memory.md)
- [docs/guides/provider-auth.md](./docs/guides/provider-auth.md)
- [docs/guides/dynamic-workflows.md](./docs/guides/dynamic-workflows.md)

## Architecture

```text
Browser / Electron renderer
        |
        | fetch / EventSource
        v
Next.js app routes
        |
        | direct SDK calls
        v
@earendil-works/pi-coding-agent
        |
        v
~/.pi/ credentials + ~/.shaula/ app state
```

Shaula is local-first: no backend database is required.

## Release Checklist

Before publishing a release:

```bash
npm run typecheck
npm run lint
npm test
npm run perf:size
npm pack --dry-run
```

For desktop packages, prefer GitHub Actions over local release builds so the
installer output is reproducible from the public repository.

## License

MIT. See [LICENSE](./LICENSE).
