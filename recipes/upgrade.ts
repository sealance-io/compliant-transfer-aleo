import type { LionDenRuntimeEnvironment } from "@lionden/core";
import { upgradeProgram } from "../lib/Upgrade.js";

export default async function (lre: LionDenRuntimeEnvironment) {
  const programFlagIndex = process.argv.indexOf("--program");

  if (programFlagIndex === -1 || !process.argv[programFlagIndex + 1]) {
    console.error(
      "Expected --program argument! Usage: lionden recipe --file recipes/upgrade.ts --network <network> --program <programName>",
    );
    process.exit(1);
  }

  const programName = process.argv[programFlagIndex + 1];

  const isUpgradeSuccessful = await upgradeProgram(lre, programName, {
    generateTypechain: true,
  });

  if (!isUpgradeSuccessful) {
    console.error(`Upgrading ${programName} failed`);
  }
}
