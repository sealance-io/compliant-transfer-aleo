import { BaseContract } from "../contract/base-contract";
import { ExecutionMode } from "@doko-js/core";
import { Multisig_coreContract } from "../artifacts/js/multisig_core";
import { ZERO_ADDRESS } from "@sealance-io/policy-engine-aleo";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });
const [deployerAddress, , , , , , , , , , , , signer1, signer2] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const signer1rPrivKey = contract.getPrivateKey(signer1);
const signer2PrivateKey = contract.getPrivateKey(signer2);

const defaultAleoSigners = [signer1, signer2, ZERO_ADDRESS, ZERO_ADDRESS];
const defaultEcdsaSigners = Array(4).fill(Array(20).fill(0));
const defaultThreshold = 2;

const multiSigContract = new Multisig_coreContract({
  mode,
  privateKey: deployerPrivKey,
});
const multiSigContractForSigner1 = new Multisig_coreContract({
  mode,
  privateKey: signer1rPrivKey,
});
const multiSigContractForSigner2 = new Multisig_coreContract({
  mode,
  privateKey: signer2PrivateKey,
});

export async function createWallet(
  walletId: string,
  threshold: number = defaultThreshold,
  aleoSigners: string[] = defaultAleoSigners,
  ecdsaSigners: number[][] = defaultEcdsaSigners,
) {
  try {
    await multiSigContract.wallets_map(walletId);
  } catch {
    const tx = await multiSigContract.create_wallet(walletId, threshold, aleoSigners, ecdsaSigners);
    await tx.wait();
  }
}

export async function approveRequest(walletId: string, signingOpId: bigint) {
  let tx = await multiSigContractForSigner1.sign(walletId, signingOpId);
  await tx.wait();
  tx = await multiSigContractForSigner2.sign(walletId, signingOpId);
  await tx.wait();
}

export async function initializeMultisig() {
  try {
    await multiSigContract.program_settings_map(true);
  } catch {
    const tx = await multiSigContract.init(false);
    await tx.wait();
  }
}
