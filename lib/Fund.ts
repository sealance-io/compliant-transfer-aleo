import { CreditsContract } from "../artifacts/js/credits";
import { mode } from "./Constants";
import { BaseContract } from '../contract/base-contract';

const contract = new BaseContract({ mode });
const [deployerAddress] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);

const creditsContract = new CreditsContract({ mode, privateKey: deployerPrivKey });

export async function fundWithCredits(account: string, amount: bigint) {
  // Fund admin if he doesn't have any balance - essential for the local deployment
  const balance = await creditsContract.account(account, 0n);
  // BUG: it doesn't work, the call doesn't return anything
  if (balance === 0n) {
    const tx = await creditsContract.transfer_public(account, amount);
    await tx.wait();
  }
}
