# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a compliant token transfer implementation on the Aleo blockchain, utilizing zero-knowledge proofs for privacy while maintaining regulatory compliance. The project uses Leo programs (Aleo smart contracts) compiled via doko-js and tested using Amareleo chain in Docker containers.

## Essential Commands

### Build and Compilation
```bash
# Compile all Leo programs to Aleo instructions and generate TypeScript bindings
npm run compile  # Runs: rimraf artifacts && dokojs compile

# Format code
npm run format:fix  # Prettier with 120 char line width, 2 spaces, trailing commas
```

### Testing
```bash
# Run all tests (automatically starts Amareleo container via testcontainers)
npm test

# Run specific test file
npm run test:select ./test/merkle_tree.test.ts

# Test environment variables
USE_TEST_CONTAINERS=false  # Disable testcontainers (requires manual Amareleo)
AMARELEO_IMAGE=custom/image:tag  # Use custom Amareleo image
AMARELEO_VERBOSITY=2  # Set verbosity (0-4, default 1)
```

**Important**: Tests are extremely slow due to full ZK proof generation. Each test can take several minutes.

### Deployment
```bash
# Deploy to local devnet
npm run deploy:devnet

# Deploy to testnet
npm run deploy:testnet

# Update freeze list
npm run update-freeze-list:devnet
npm run update-freeze-list:testnet
```

## High-Level Architecture

### Program Flow and Dependencies

The system implements a multi-layered compliance architecture where programs import and depend on each other:

```
token_registry.aleo (base token implementation)
    ↑
merkle_tree.aleo (privacy-preserving proofs)
    ↑
sealance_freezelist_registry.aleo (sanctions management)
    ↑
sealed_*_policy.aleo programs (compliance policies)
    ↑
gqrfmwbtyp.aleo (token exchange)
```

### Core Design Patterns

1. **Privacy-Compliance Balance**: All policy programs follow a pattern where:
   - Transaction details are private by default (using records)
   - Compliance records are generated for investigators
   - Freeze list checks use Merkle proofs for privacy-preserving verification

2. **Role-Based Access Control**: Programs use mapping-based roles:
   - `ADMIN_INDEX = 1u8`: Contract administrator
   - `INVESTIGATOR_INDEX = 2u8`: Compliance officer
   - Roles stored in `mapping roles: u8 => address`

3. **Merkle Root Transitions**: Freeze list updates maintain both current and previous roots with configurable block windows for smooth transitions.

### Contract Interaction Pattern

All TypeScript contract interactions follow this pattern:

```typescript
// 1. Create contract instance with execution mode and private key
const contract = new ContractNameContract({
  mode: ExecutionMode.SnarkExecute,  // or SnarkProve, Evaluate
  privateKey: deployerPrivKey,
});

// 2. Check deployment status
const isDeployed = await contract.isDeployed();

// 3. Execute transitions (returns TransactionResponse)
const tx = await contract.transition_name(params);
await tx.wait();  // Wait for confirmation

// 4. Decrypt private outputs
const decryptedRecord = decryptRecordType(ciphertext, viewKey);
```

### Testing Infrastructure

Tests use a specific setup pattern:
1. **Global Setup** (`vitest.global-setup.ts`): Starts Amareleo container on port 3030
2. **Test Execution**: Sequential, single-threaded (no parallelism due to shared chain state)
3. **Account Management**: Uses `aleo-config.js` network configurations with predefined roles
4. **Deployment Pattern**: `deployIfNotDeployed()` ensures contracts exist before testing

### Key Libraries and Helpers

- **`lib/FreezeList.ts`**: Merkle tree operations for freeze list management
- **`lib/Token.ts`**: Token initialization and management utilities
- **`lib/Fund.ts`**: Credit funding for test accounts
- **`lib/Deploy.ts`**: Deployment utilities
- **`lib/Role.ts`**: Role management helpers
- **`contract/base-contract.ts`**: Base class for all contract interactions

### Configuration Files

- **`aleo-config.js`**: Network endpoints, accounts, and execution modes
- **`.env`**: Private keys for different roles (deployer, admin, investigator, users)
- **`vitest.config.ts`**: Test configuration with 50-minute timeouts, no parallelism

## Critical Implementation Details

### Leo Program Structure

Each Leo program follows this structure:
- Constants for configuration (TOKEN_ID, ZERO_ADDRESS, indices)
- Mappings for on-chain state
- Structs for complex data (MerkleProof, TokenOwner)
- Records for private data (ComplianceRecord)
- Transitions (public entry points) and functions (internal logic)

### Private Key Management

The system uses 6 predefined accounts from `aleo-config.js`:
1. Deployer (index 0)
2. Admin (index 1)
3. Investigator (index 2)
4. Frozen Account (index 3)
5. Sender (index 4)
6. Recipient (index 5)

### Freeze List Implementation

The freeze list uses a dual-storage approach:
- `mapping freeze_list: address => bool` for O(1) lookup
- `mapping freeze_list_index: u32 => address` for enumeration
- Merkle tree for privacy-preserving verification

### Compliance Policies

Three compliance levels implemented:
1. **Report Policy**: All transactions generate compliance records
2. **Threshold Policy**: Only transactions >1000 generate reports
3. **Timelock Policy**: Funds locked for specified periods

## Development Prerequisites

- **Leo CLI v2.6.1**: Required but used indirectly through doko-js
- **Node.js v22**: For npm packages and TypeScript
- **Docker/Podman**: For running Amareleo test containers
- **doko-js CLI**: Installed globally or via build script

## Common Issues and Solutions

1. **Container Authentication**: If using ghcr.io images, run `docker login ghcr.io` first
2. **Test Timeouts**: Tests are slow; 50-minute timeout is normal for full suite
3. **Permission Errors**: May see "dotnet: Permission denied" warnings (can be ignored)
4. **Patches**: Project uses patch-package for @doko-js/core fixes