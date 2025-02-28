import { ExecutionMode } from "@doko-js/core";

import { Token_registryContract } from "../artifacts/js/token_registry";
import { RediwsozfoContract } from "../artifacts/js/rediwsozfo";
import { TqxftxoicdContract } from "../artifacts/js/tqxftxoicd";

const mode = ExecutionMode.SnarkExecute;
const tokenRegistryContract = new Token_registryContract({ mode });
const compliantTransferContract = new TqxftxoicdContract({ mode })
const merkleTreeContract = new RediwsozfoContract({ mode });

const PROGRAM_ADDRESS = "aleo10ha27yxrya7d7lf0eg5p3hqcafm8k6nj00pvgeuxuqmvhqpst5xsdh2ft4";

const tokenName = "SEALEDTOKEN";
const tokenSymbol = "SEALED";
const tokenId = stringToBigInt(tokenName);

function stringToBigInt(asciiString) {
  let bigIntValue = 0n;
  for (let i = 0; i < asciiString.length; i++) {
    bigIntValue = (bigIntValue << 8n) + BigInt(asciiString.charCodeAt(i));
  }
  return bigIntValue;
}

(async () => {
  let tx = await tokenRegistryContract.deploy();
  await tx.wait();

  tx = await tokenRegistryContract.register_token(
    tokenId, // tokenId
    stringToBigInt(tokenName), // tokenId
    stringToBigInt(tokenSymbol), // name
    6, // decimals
    1000_000000000000n, // max supply
    true,
    PROGRAM_ADDRESS
  );
  await tx.wait();
  
  tx = await tokenRegistryContract.set_role(
    tokenId,
    PROGRAM_ADDRESS,
    3, // SUPPLY_MANAGER_ROLE
  );
  await tx.wait();

  tx = await merkleTreeContract.deploy();
  await tx.wait();

  tx = await compliantTransferContract.deploy();
  await tx.wait();

})();
