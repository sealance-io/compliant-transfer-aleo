import { ExecutionMode } from "@doko-js/core";

import { Token_registryContract } from "../artifacts/js/token_registry";
import { RediwsozfoContract } from "../artifacts/js/rediwsozfo";
import { TqxftxoicdContract } from "../artifacts/js/tqxftxoicd";
import { BaseContract } from "../contract/base-contract";
import networkConfig from '../aleo-config';
import { CreditsContract } from "../artifacts/js/credits";

const mode = ExecutionMode.SnarkExecute;
networkConfig.networks.testnet.endpoint = process.env.ENDPOINT ?? networkConfig.networks.testnet.endpoint;
const creditsContract = new CreditsContract({ mode, privateKey: process.env.ALEO_PRIVATE_KEY_TESTNET3 })
const tokenRegistryContract = new Token_registryContract({ mode });
const compliantTransferContract = new TqxftxoicdContract({ mode })
const merkleTreeContract = new RediwsozfoContract({ mode });

const ADMIN = "aleo1lwa86hr7qx99d7e3dcyv2s7wt9g8rmd6qxzm5zprad0c4ejynsqqvaxysn";
const PROGRAM_ADDRESS = "aleo10ha27yxrya7d7lf0eg5p3hqcafm8k6nj00pvgeuxuqmvhqpst5xsdh2ft4";
const ZERO_ADDRESS = "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc";
const freezedAccount = "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t"

const tokenName = "SEALEDTOKEN";
const tokenSymbol = "SEALED";
const tokenId = stringToBigInt(tokenName);
const fundedAmount = 10000000000000n;


function stringToBigInt(asciiString) {
  let bigIntValue = 0n;
  for (let i = 0; i < asciiString.length; i++) {
    bigIntValue = (bigIntValue << 8n) + BigInt(asciiString.charCodeAt(i));
  }
  return bigIntValue;
}

async function deployIfNotDeployed(contract: BaseContract) {
  const isDeployed = await contract.isDeployed();
  if (!isDeployed) {
    const tx = await contract.deploy();
    await tx.wait();
  }
}

async function fundAdmin() {
  // Fund admin if he doesn't have any balance - essential for the local deployment
  const balance = await creditsContract.account(ADMIN, 0n);
  if (balance === 0n) {
    const tx = await creditsContract.transfer_public(ADMIN, fundedAmount);
    await tx.wait();
  }
}

async function registerTokenAndAuthorizationnParty() {
  // register token and assign compliant transfer contract as external_authorization_party
  const tokenMetadata = await tokenRegistryContract.registered_tokens(
    tokenId, 
    {
      token_id: 0n, 
      name: 0n,
      symbol: 0n,
      decimals: 0,
      supply: 0n,
      max_supply: 0n,
      admin: ZERO_ADDRESS,
      external_authorization_required: false,
      external_authorization_party: ZERO_ADDRESS
    }
  );
  if(tokenMetadata.token_id === 0n) {
    const tx = await tokenRegistryContract.register_token(
      tokenId, // tokenId
      stringToBigInt(tokenName), // tokenId
      stringToBigInt(tokenSymbol), // name
      6, // decimals
      1000_000000000000n, // max supply
      true,
      PROGRAM_ADDRESS
    );
    tx.wait();
  } else if(tokenMetadata.external_authorization_party !== PROGRAM_ADDRESS) {
    const tx = await tokenRegistryContract.update_token_management(
      tokenId,
      ADMIN,
      PROGRAM_ADDRESS
    )
    await tx.wait();
  }
}

async function assignRole(address: string, role: number) {
  const setRoleTx = await tokenRegistryContract.set_role(
    tokenId,
    address,
    role,
  );
  await setRoleTx.wait();
}

async function AddToFreezeList(address: string, leavesLength: number) {
  const isAccountFreezed = await compliantTransferContract.freeze_list(address, false)
  if (!isAccountFreezed) {
    let addresses: string[] = [];//Array(leavesLength).fill(ZERO_ADDRESS);
    let lastIndex = 0;
    for(let i = 0; addresses.length < leavesLength; i++) {
      try {
        addresses.push(await compliantTransferContract.freeze_list_index(i));
        lastIndex = i + 1;
      } 
      catch {
        break;
      } 
    }
    if(addresses.length === leavesLength) {
      throw new Error("Merkle tree is full, there is no place for the new freezed account");
    }
    addresses.push(freezedAccount);
    addresses = addresses.concat(Array(leavesLength - addresses.length).fill(ZERO_ADDRESS));
    
    const sortTx = await merkleTreeContract.build_tree(addresses);
    let [tree] = await sortTx.wait();
    // Sorting addresses based on numbers array
    const sortedAddresses = addresses
      .map((address, index) => ({ address, number: tree[index] })) // Pair addresses with numbers
      .sort((a, b) => (a.number < b.number ? -1 : 1)) // Sort using BigInt comparison
      .map(item => item.address); // Extract sorted addresses
    const buildTreeTx = await merkleTreeContract.build_tree(sortedAddresses);
    [tree] = await buildTreeTx.wait();
    const root = tree[14];
    await compliantTransferContract.update_freeze_list(
      freezedAccount,
      true,
      lastIndex,
      root
    );
  }
}

(async () => {
  await fundAdmin();

  // deploy contracts
  await deployIfNotDeployed(tokenRegistryContract);
  await deployIfNotDeployed(merkleTreeContract);
  await deployIfNotDeployed(compliantTransferContract);

  await registerTokenAndAuthorizationnParty();

  // We need to call this function only because demo_faucet
  await assignRole(PROGRAM_ADDRESS, 1);

  // add freezed account to the freeze list
  await AddToFreezeList(freezedAccount, 8);
  process.exit(0);
})();
