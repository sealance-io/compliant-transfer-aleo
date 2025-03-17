import { CreditsContract } from "../artifacts/js/credits";
import { mode } from "./Constants";

const creditsContract = new CreditsContract({ mode, privateKey: process.env.ALEO_PRIVATE_KEY_TESTNET3 })

export async function fundWithCredits(account: string, amount: bigint) {
  // Fund admin if he doesn't have any balance - essential for the local deployment
  const balance = await creditsContract.account(account, 0n);
  if (balance === 0n) {
    const tx = await creditsContract.transfer_public(account, amount);
    await tx.wait();
  }
}
