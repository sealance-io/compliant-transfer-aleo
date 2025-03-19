import { ExecutionMode } from "@doko-js/core";
import { TqxftxoicdContract } from "../artifacts/js/tqxftxoicd";
import { deployIfNotDeployed } from "../lib/Deploy";
import { BaseContract } from '../contract/base-contract';
import { AddToFreezeList } from "../lib/FreezeList";
import networkConfig from '../aleo-config';
import { fundWithCredits } from "../lib/Fund";


const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });
const [_, adminAddress] = contract.getAccounts();
const adminPrivKey = contract.getPrivateKey(adminAddress);

const compliantTransferContract = new TqxftxoicdContract({ mode, privateKey: adminPrivKey });

(async () => {
    if (process.argv.length === 2) {
        console.error('Expected at least one argument! Usage: npx tsx scripts/addFreezeList.ts <address> [testnet]');
        process.exit(1);
    }

    if (process.argv[3] === 'testnet') {
        console.log("Using Aleo Testnet!!!")
        networkConfig.networks.testnet.endpoint = "https://capable.snarkos.net";
    }

    // deploy contracts
    await deployIfNotDeployed(compliantTransferContract);

    const {lastIndex, root} = await AddToFreezeList(process.argv[2], 8);
    await compliantTransferContract.update_freeze_list(
        process.argv[2],
        true,
        lastIndex,
        root
    );

    process.exit(0);
})();
