import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

export const PERSIST = "/tmp/bepulmed-it";

export default function setup() {
  rmSync(PERSIST, { recursive: true, force: true });
  execSync(`npx wrangler d1 migrations apply bepulmed --local --persist-to ${PERSIST}`, { stdio: "ignore", env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" } });
}
