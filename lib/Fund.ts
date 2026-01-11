import { CreditsContract } from "../artifacts/js/credits";
import { mode } from "./Constants";

export async function fundWithCredits(funderPrivKey: string, account: string, amount: bigint) {
  const creditsContract = new CreditsContract({
    mode,
    privateKey: funderPrivKey,
  });
  // Fund account if he doesn't have sufficient balance - essential for the local deployment
  const balance = await creditsContract.account(account, 0n);
  if (balance < amount) {
    // TODO: check and err if funder has insuffcient funds to make sure error is clear
    const tx = await creditsContract.transfer_public(account, amount - balance);
    await tx.wait();
  }
}
