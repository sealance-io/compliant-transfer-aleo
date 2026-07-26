import type { LionDenPlugin } from "@lionden/core";

/**
 * Registers the containerized devnet lifecycle (see `devnet-container.ts`).
 *
 * `lionden.config.ts` only adds this plugin when `TEST_MODE=devnet`, so devnode
 * runs pay nothing for it.
 *
 * The handler map is a **lazy factory**, not an eager object: Vitest workers
 * re-import `lionden.config.ts` but never dispatch `testing` hooks, so the
 * container module is only ever evaluated in the parent CLI process.
 */
const devnetContainerPlugin: LionDenPlugin = {
  id: "sealance/devnet-container",
  name: "Devnet Container",
  hookHandlers: {
    // Explicit .ts extension — this module is reached from lionden.config.ts,
    // which Vitest workers load with Node's native TypeScript loader.
    testing: () => import("./devnet-container.ts"),
  },
};

export default devnetContainerPlugin;
