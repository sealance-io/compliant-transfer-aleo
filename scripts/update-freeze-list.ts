import { ExecutionMode } from "@doko-js/core";
import { Tqxftxoicd_v2Contract } from "../artifacts/js/tqxftxoicd_v2";
import { BaseContract } from '../contract/base-contract';
import { AddToFreezeList } from "../lib/FreezeList";
import networkConfig from '../aleo-config';

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });
const [_, adminAddress] = contract.getAccounts();
const adminPrivKey = contract.getPrivateKey(adminAddress);

const compliantTransferContract = new Tqxftxoicd_v2Contract({ mode, privateKey: adminPrivKey });

(async () => {
    if (process.argv.length === 2) {
        console.error('Expected at least one argument! Usage: npx tsx scripts/update-freeze-list.ts <address> [testnet]');
        process.exit(1);
    }

    const isDeployed = await compliantTransferContract.isDeployed();
    if (!isDeployed) {
        console.error('Contract is not deployed. Please deploy the contract first.');
        process.exit(1);
    }

    let role = await compliantTransferContract.roles(1);
    if (adminAddress !== role) {
        console.error('The used account does not have admin permissions. Please check the environment file for the correct account.');
        process.exit(1);
    }

    const {lastIndex, root} = await AddToFreezeList(process.argv[2], 8);
    await compliantTransferContract.update_freeze_list(
        process.argv[2],
        true,
        lastIndex,
        root
    );

    process.exit(0);
})();
