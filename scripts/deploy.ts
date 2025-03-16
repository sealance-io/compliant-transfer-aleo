import { ExecutionMode } from "@doko-js/core";

import { Token_registryContract } from "../artifacts/js/token_registry";
import { RediwsozfoContract } from "../artifacts/js/rediwsozfo";
import { TqxftxoicdContract } from "../artifacts/js/tqxftxoicd";
import networkConfig from '../aleo-config';
import { ADMIN, FREEZED_ACCOUNT, fundedAmount } from "../lib/Constants";
import { funWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { AddToFreezeList } from "../lib/FreezeList";
import { registerTokenAndAuthorizationnParty } from "../lib/Token";

const mode = ExecutionMode.SnarkExecute;
networkConfig.networks.testnet.endpoint = process.env.ENDPOINT ?? networkConfig.networks.testnet.endpoint;
const tokenRegistryContract = new Token_registryContract({ mode });
const compliantTransferContract = new TqxftxoicdContract({ mode })
const merkleTreeContract = new RediwsozfoContract({ mode });

(async () => {
  await funWithCredits(ADMIN, fundedAmount);

  // deploy contracts
  await deployIfNotDeployed(tokenRegistryContract);
  await deployIfNotDeployed(merkleTreeContract);
  await deployIfNotDeployed(compliantTransferContract);

  // register token and/or assign compliant transfer program as external authorization paryy
  await registerTokenAndAuthorizationnParty();

  // add freezed account to the freeze list
  await AddToFreezeList(FREEZED_ACCOUNT, 8);
  process.exit(0);
})();
