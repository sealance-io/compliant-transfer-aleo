import { CreditsContract } from "../artifacts/js/credits";
import { mode } from "./Constants";

const creditsContract = new CreditsContract({ mode })

export async function fundWithCredits(account: string, amount: bigint) {
  // Fund admin if he doesn't have any balance - essential for the local deployment
  console.log("check");

  const balance = await creditsContract.account(account, 0n);

  console.log(balance);

  if (balance === 0n) {
    console.log("inside");
    const tx = await creditsContract.transfer_public(account, amount);
    await tx.wait();
  }
  console.log("outside");
}
