import type { D1Migration } from "cloudflare:test";
import type { Env as KabotEnv } from "../src/env";

declare global {
  namespace Cloudflare {
    interface Env extends KabotEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
