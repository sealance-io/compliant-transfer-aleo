import { ExecutionMode } from "@doko-js/core";
import { Sealed_report_policyContract } from "../artifacts/js/sealed_report_policy";
import { BaseContract } from "../contract/base-contract";
import { calculateFreezeListUpdate, FreezeStatus } from "../lib/FreezeList";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });
const [_, adminAddress] = contract.getAccounts();
const adminPrivKey = contract.getPrivateKey(adminAddress);

const compliantTransferContract = new Sealed_report_policyContract({
  mode,
  privateKey: adminPrivKey,
});

(async () => {
  if (process.argv.length === 2) {
    console.error("Expected at least one argument! Usage: npx tsx scripts/update-freeze-list.ts <address> [testnet]");
    process.exit(1);
  }

  const isDeployed = await compliantTransferContract.isDeployed();
  if (!isDeployed) {
    console.error("Contract is not deployed. Please deploy the contract first.");
    process.exit(1);
  }

  let role = await compliantTransferContract.roles(1);
  if (adminAddress !== role) {
    console.error(
      "The used account does not have admin permissions. Please check the environment file for the correct account.",
    );
    process.exit(1);
  }

  const newAddress = process.argv[2];
  const updateResult = await calculateFreezeListUpdate(newAddress, 8);

  switch (updateResult.status) {
    case FreezeStatus.NEW_ENTRY:
      await compliantTransferContract.update_freeze_list(newAddress, true, updateResult.lastIndex, updateResult.root);
      break;

    case FreezeStatus.ALREADY_FROZEN:
      console.log("Address already frozen, no action needed");
      break;
  }

  process.exit(0);
})();
