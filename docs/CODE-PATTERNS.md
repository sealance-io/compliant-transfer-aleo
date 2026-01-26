# Code Patterns

Common patterns and examples for working with this codebase.

## Contract Interaction

All TypeScript contract interactions follow this pattern:

```typescript
// 1. Create contract instance with execution mode and private key
const contract = new ContractNameContract({
  mode: ExecutionMode.SnarkExecute, // or SnarkProve, Evaluate
  privateKey: deployerPrivKey,
});

// 2. Check deployment status
const isDeployed = await contract.isDeployed();

// 3. Execute transitions (returns TransactionResponse)
const tx = await contract.transition_name(params);
await tx.wait(); // Wait for confirmation

// 4. Decrypt private outputs
const decryptedRecord = decryptRecordType(ciphertext, viewKey);
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

1. **Fund accounts** (`lib/Fund.ts`)
2. **Deploy** (`deployIfNotDeployed()`)
3. **Initialize** (roles, freeze list)
4. **Execute** transition
5. **Verify** with decrypt utilities

Example:

```typescript
import { fundAccount, deployIfNotDeployed } from "../lib";

describe("Policy Tests", () => {
  beforeAll(async () => {
    await fundAccount(deployerAddress);
    await deployIfNotDeployed(contract);
    await initializeRoles();
  });

  it("should execute compliant transfer", async () => {
    const tx = await contract.transfer(recipient, amount, proofs);
    await tx.wait();
    // Verify state
  });
});
```

## Key Libraries (`/lib`)

| Module          | Purpose                                           |
| --------------- | ------------------------------------------------- |
| `FreezeList.ts` | `getLeafIndices()`, `getSiblingPath()` for Merkle |
| `Deploy.ts`     | `deployIfNotDeployed()` utility                   |
| `Fund.ts`       | Credit funding for test accounts                  |
| `Token.ts`      | Token operation utilities                         |
| `Role.ts`       | Role management utilities                         |
| `Block.ts`      | Block height utilities                            |
| `Constants.ts`  | `MAX_TREE_DEPTH`, `ZERO_ADDRESS`, etc.            |
| `Initialize.ts` | Initialization helpers                            |
| `Multisig.ts`   | Multi-signature utilities                         |
| `Upgrade.ts`    | Contract upgrade utilities                        |
