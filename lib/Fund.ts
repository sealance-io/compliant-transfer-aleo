import type { SignableNamedAccount } from "@lionden/config";
import type { DeploymentContext } from "@lionden/plugin-deploy";
import { type TestContext } from "@lionden/testing";

export async function fundWithCredits(
  ctx: TestContext | DeploymentContext,
  account: string,
  amount: bigint,
  signer: SignableNamedAccount,
) {
  const balance = await ctx.connection.getBalance(account);
  if (balance < amount) {
    const missingAmount = amount - balance;
    await ctx.execute("credits.aleo", "transfer_public", [account, `${missingAmount}u64`], {
      signer,
    });
  }
}
