import { ExecutionMode } from "@doko-js/core";
import { BaseContract } from "../contract/base-contract";
import { upgradeProgram } from "../lib/Upgrade";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });
const [deployerAddress] = await contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);

(async () => {
  if (process.argv.length <= 2) {
    console.error("Expected at least one argument! Usage: npx tsx scripts/upgrade.ts <programName> [testnet]");
    process.exit(1);
  }
  const programName = process.argv[2];
  const isUpgradeSuccessful = await upgradeProgram(programName, deployerPrivKey);
  if (!isUpgradeSuccessful) {
    console.error(`Upgrading ${programName} failed`);
    process.exit(1);
  }

  process.exit(0);
})();
