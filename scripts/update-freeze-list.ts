import { ExecutionMode } from "@doko-js/core";
import { Sealed_report_policyContract } from "../artifacts/js/sealed_report_policy";
import { BaseContract } from "../contract/base-contract";
import { calculateFreezeListUpdate, FreezeStatus } from "../lib/FreezeList";
import { CURRENT_FREEZE_LIST_ROOT_INDEX, FREEZE_LIST_LAST_INDEX, ZERO_ADDRESS } from "../lib/Constants";
import { Sealance_freezelist_registryContract } from "../artifacts/js/sealance_freezelist_registry";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });
const [_, adminAddress] = contract.getAccounts();
const adminPrivKey = contract.getPrivateKey(adminAddress);

// const reportPolicyContract = new Sealed_report_policyContract({
//   mode,
//   privateKey: adminPrivKey,
// });

const reportPolicyContract = new Sealance_freezelist_registryContract({
  mode,
  privateKey: adminPrivKey,
});

(async () => {
  if (process.argv.length === 2) {
    console.error("Expected at least one argument! Usage: npx tsx scripts/update-freeze-list.ts <address> [testnet]");
    process.exit(1);
  }

  const isDeployed = await reportPolicyContract.isDeployed();
  if (!isDeployed) {
    console.error("Contract is not deployed. Please deploy the contract first.");
    process.exit(1);
  }

  let role = await reportPolicyContract.roles(1);
  if (adminAddress !== role) {
    console.error(
      "The used account does not have admin permissions. Please check the environment file for the correct account.",
    );
    process.exit(1);
  }

  const newAddress = process.argv[2];
  const previousRoot = await reportPolicyContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
  const updateResult = await calculateFreezeListUpdate(newAddress, 8);

    // let addresses: string[] = [];
    // const lastIndex = await reportPolicyContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);
    // for (let i = 0; i <= lastIndex; i++) {
    //   addresses.push(await reportPolicyContract.freeze_list_index(i));
    // }
  
    // console.dir(addresses);


  switch (updateResult.status) {
    case FreezeStatus.NEW_ENTRY:
      await reportPolicyContract.update_freeze_list(
        newAddress,
        true,
        updateResult.frozenIndex,
        previousRoot,
        updateResult.root,
      );
      break;

    case FreezeStatus.ALREADY_FROZEN:
      console.log("Address already frozen, no action needed");
      break;
  }

  process.exit(0);
})();
