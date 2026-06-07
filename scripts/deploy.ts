import type { LionDenRuntimeEnvironment } from "@lionden/core";

export default async function (lre: LionDenRuntimeEnvironment) {
  console.log(lre.network.activeConnection.name);
  await lre.tasks.run("compile");
  await lre.tasks.run("recipe", { file: "recipes/setup.ts", network: lre.network.activeConnection.name });
}
