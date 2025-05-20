import { CreditsContract } from "../artifacts/js/credits";
import { mode } from "./Constants";

export async function fundWithCredits(funderPrivKey: string, account: string, amount: bigint) {
  const creditsContract = new CreditsContract({
    mode,
    privateKey: funderPrivKey,
  });
  // Fund account if he doesn't have any balance - essential for the local deployment
  const balance = await creditsContract.account(account, 0n);
  if (balance === 0n) {
    const tx = await creditsContract.transfer_public(account, amount);
    await tx.wait();
  }
}
