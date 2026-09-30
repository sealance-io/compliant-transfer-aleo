# Code Patterns

Common patterns and examples for working with this codebase.

## Contract Interaction

Contracts are typed bindings generated into `/typechain` by `npm run compile`:

```typescript
import { createCompliantTokenTemplate } from "../typechain/CompliantTokenTemplate.js";
import { asSigner } from "../lib/LiondenAdapters.js";

// 1. Bind the generated contract to the LionDen runtime
const token = createCompliantTokenTemplate().connect(ctx.lre);
const minter = ctx.named.signer("minter");

// 2. Execute transitions; each exposes accepted / rejected / settled / submitted,
//    plus locally / failsLocally for off-chain execution
const tx = await token.mint_private.accepted(recipient, amount, asSigner(minter));
await token.burn_private.rejected(record, amount, asSigner(recipient));

// 3. Decrypt private outputs with the owning signer
const record = await tx.outputs[1].decrypt(recipient);

// 4. Read public state
const info = await token.mappings.tokenInfo.get(true);
const paused = await token.storage.isPaused.getOrUse(false);
const balance = await token.views.balanceOf(recipient);
```

## Working with Freeze Lists

```typescript
import { PolicyEngine } from "@sealance-io/policy-engine-aleo";

const engine = new PolicyEngine({
  endpoint: "http://localhost:3030",
  network: "testnet",
});

// Fetch freeze list
const freezeList = await engine.fetchFreezeListFromChain("sealance_freezelist_registry.aleo");

// Generate proof that address is NOT frozen
const witness = await engine.generateFreezeListNonInclusionProof("aleo1...", {
  programId: "sealance_freezelist_registry.aleo",
});

// Use witness.proofs in Leo transaction
```

## Test Structure

Tests follow this sequence:

1. **Fund accounts** (`fundWithCredits()` from `lib/Fund.ts`)
2. **Deploy** (`ctx.deploy()` through LionDen)
3. **Initialize** (program-specific setup transitions)
4. **Execute** transition
5. **Verify** with decrypt utilities

Example:

```typescript
import { setup } from "@lionden/testing";
import { fundWithCredits } from "../lib/Fund.js";

describe("Policy Tests", () => {
  beforeAll(async () => {
    const ctx = await setup();
    await fundWithCredits(ctx, account.address, fundedAmount, deployer);
    await ctx.deploy("program_name", { noCompile: true });
    await contract.initialize.accepted(...params);
  });

  it("should execute compliant transfer", async () => {
    const tx = await contract.transfer(recipient, amount, proofs);
    await tx.wait();
    // Verify state
  });
});
```

## Key Libraries (`/lib`)

| Module               | Purpose                                    |
| -------------------- | ------------------------------------------ |
| `Block.ts`           | Block height utilities                     |
| `Constants.ts`       | Shared constants, policy metadata, roles   |
| `Fund.ts`            | Credit funding for test accounts           |
| `LiondenAdapters.ts` | Type and signer adapters for LionDen calls |
| `Multisig.ts`        | Multi-signature utilities                  |
| `Token.ts`           | Token operation utilities                  |
| `Upgrade.ts`         | Contract upgrade utilities                 |
