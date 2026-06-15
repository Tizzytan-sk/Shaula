import { spawnSync } from "node:child_process";

const noStandalone = process.argv.includes("--no-standalone");
const env = { ...process.env };

if (noStandalone) {
  env.SHAULA_NO_STANDALONE = "1";
}

const result = spawnSync("next", ["build", "--webpack"], {
  env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
