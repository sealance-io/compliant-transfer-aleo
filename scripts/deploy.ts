import type { LionDenRuntimeEnvironment } from "@lionden/core";

export default async function (lre: LionDenRuntimeEnvironment) {
  await lre.tasks.run("compile");
  await lre.tasks.run("recipe", { file: "recipes/setup.ts" });
}
