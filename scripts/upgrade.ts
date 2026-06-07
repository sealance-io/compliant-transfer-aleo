import type { LionDenRuntimeEnvironment } from "@lionden/core";

export default async function (lre: LionDenRuntimeEnvironment) {
  await lre.tasks.run("compile");
  await lre.tasks.run("recipe", { file: "recipes/upgrade.ts", network: lre.network.activeConnection.name });
}
