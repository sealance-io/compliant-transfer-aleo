import { type TestContext } from "@lionden/testing";

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function getLatestBlockHeight(ctx: TestContext) {
  return ctx.connection.getBlockHeight();
}

export async function waitBlocks(ctx: TestContext, blocks: number) {
  const startHeight = await getLatestBlockHeight(ctx);
  const targetHeight = startHeight + blocks;

  if (ctx.connection.advanceBlocks) {
    await ctx.connection.advanceBlocks(blocks);
  }

  while (true) {
    const currentHeight = await getLatestBlockHeight(ctx);
    if (currentHeight >= targetHeight) {
      return;
    }
    await sleep(1000);
  }
}
