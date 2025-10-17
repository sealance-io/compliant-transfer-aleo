# Development Guide

## Project Structure

```
packages/policy-engine-sdk/
├── src/
│   ├── index.ts           # Main entry point and exports
│   ├── types.ts           # TypeScript type definitions
│   ├── policy-engine.ts   # Main PolicyEngine class
│   ├── api-client.ts      # Aleo API client with retry logic
│   ├── merkle-tree.ts     # Merkle tree utilities
│   └── conversion.ts      # Address/field conversion utilities
├── examples/              # Usage examples
├── dist/                  # Compiled output (generated)
├── package.json
├── tsconfig.json
└── README.md
```

## Development Workflow

### Initial Setup

**IMPORTANT**: This package is part of an npm workspace. Always install dependencies from the repository root:

```bash
# From repository root (RECOMMENDED)
cd /path/to/compliant-transfer-aleo
npm ci

# This installs dependencies for both root and all workspace packages
# The root package-lock.json manages all dependencies
```

**Note**: Do not run `npm install` directly in the SDK directory. The workspace structure requires installation from the root to ensure consistent dependency resolution across all packages.

### Building

```bash
# From repository root (RECOMMENDED)
npm run build --workspace=@sealance-io/policy-engine-aleo

# Or from SDK directory (alternative)
cd packages/policy-engine-sdk
npm run build

# Clean only
npm run clean
```

The build output goes to `dist/` and includes:
- Compiled JavaScript (ES modules)
- TypeScript declaration files (.d.ts)
- Source maps

### Code Formatting

```bash
# Check formatting
npm run format

# Fix formatting
npm run format:fix
```

Uses Prettier with the following settings:
- Print width: 120 characters
- Tab width: 2 spaces
- Trailing commas: all
- Single quotes: false
- Arrow parens: avoid

### Publishing

The SDK can be published to both GitHub npm registry and public npm registry.

**Prerequisites:**

1. **For GitHub npm registry:**
   - Create a GitHub Personal Access Token with `write:packages` permission
   - Add to `~/.npmrc`:
     ```
     //npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT
     ```

2. **For npm registry:**
   - Create an npm Access Token (Automation or Publish type)
   - Add to `~/.npmrc`:
     ```
     //registry.npmjs.org/:_authToken=YOUR_NPM_TOKEN
     ```

**Publishing Commands:**

```bash
# From SDK directory
cd packages/policy-engine-sdk

# Publish to GitHub npm registry
npm run publish:github

# Publish to public npm registry
npm run publish:npm

# If you need to provide OTP for npm (with 2FA)
npm run publish:npm:otp=123456
```

The `prepublishOnly` script automatically builds the package before publishing.

**Note**: When publishing to both registries, ensure your authentication tokens are properly configured in `~/.npmrc` as shown in the prerequisites.

## Architecture

### Core Components

#### PolicyEngine
Main class that orchestrates all operations:
- Fetching freeze lists from blockchain
- Generating non-inclusion proof
- Building Merkle trees
- Computing Merkle roots

#### AleoAPIClient
Handles all network communication:
- Fetches mapping values from Aleo nodes
- Implements retry logic with exponential backoff
- Supports custom endpoints and networks

#### Merkle Tree Utilities
Low-level functions for tree operations:
- `generateLeaves()`: Converts addresses to sorted, padded field elements
- `buildTree()`: Constructs complete Merkle tree from leaves
- `getLeafIndices()`: Finds adjacent leaf indices for non-inclusion proof
- `getSiblingPath()`: Generates Merkle proof for a leaf

#### Conversion Utilities
Address and field element conversions:
- `convertAddressToField()`: Bech32m decode to BigInt
- `convertFieldToAddress()`: BigInt to Bech32m encode
- `stringToBigInt()`: ASCII string to BigInt

### Design Decisions

1. **ESM Only**: Modern ES modules for better tree-shaking and future compatibility
2. **TypeScript**: Full type safety with declaration files for consumers
3. **Minimal Dependencies**: Only @provablehq/sdk and @scure/base required
4. **No Key Management**: SDK doesn't handle private keys or transaction signing
5. **No Transaction Submission**: SDK generates proofs, doesn't interact with wallets
6. **Stateless**: All operations are pure functions or self-contained methods
7. **Browser Compatible**: Uses standard fetch API, works in browser and Node.js

## Testing

Tests will be added later and will use similar infrastructure as the main repository:
- Vitest for test runner
- Testcontainers for Aleo devnet
- Sequential execution (no parallelism)

Planned test structure:
```
packages/policy-engine-sdk/
├── test/
│   ├── merkle-tree.test.ts
│   ├── conversion.test.ts
│   ├── api-client.test.ts
│   └── policy-engine.test.ts
├── vitest.config.ts
└── vitest.global-setup.ts
```

## Integration with Main Repository

The SDK extracts core utilities from the main repository:

| Main Repo | SDK Package |
|-----------|-------------|
| `lib/MerkleTree.ts` | `src/merkle-tree.ts` |
| `lib/Conversion.ts` | `src/conversion.ts` |
| `lib/FreezeList.ts` | `src/policy-engine.ts` |
| `lib/Constants.ts` | `src/types.ts` (config) |

The SDK version is self-contained and doesn't depend on:
- doko-js contract bindings
- Test infrastructure
- Leo programs
- Private key management

## Common Development Tasks

### Adding a New Utility Function

1. Add function to appropriate module in `src/`
2. Export from module
3. Re-export from `src/index.ts`
4. Update TypeScript types if needed
5. Add JSDoc comments
6. Update README.md with usage example

### Updating Dependencies

```bash
npm update
npm audit fix
```

### Version Bumping

Follow semantic versioning:
- Patch: Bug fixes (0.1.0 → 0.1.1)
- Minor: New features, backward compatible (0.1.0 → 0.2.0)
- Major: Breaking changes (0.1.0 → 1.0.0)

Update `package.json` version before publishing.

### Debugging

The SDK uses standard JavaScript debugging:

```typescript
// In your code
console.debug("Debug info:", value);
console.error("Error:", error);

// Run with debug output
NODE_DEBUG=* tsx examples/basic-usage.ts
```

## API Design Principles

1. **Simple Defaults**: Sensible defaults for all optional parameters
2. **Progressive Disclosure**: Basic usage is simple, advanced usage is possible
3. **Error Messages**: Clear, actionable error messages
4. **Type Safety**: Full TypeScript support with exported types
5. **Documentation**: JSDoc comments on all public APIs
6. **Consistency**: Similar patterns across all methods

## Performance Considerations

1. **Caching**: Encourage users to cache freeze lists when generating multiple proofs
2. **Retry Logic**: Built-in retry with configurable attempts and delays
3. **Tree Building**: Efficient bottom-up tree construction
4. **Memory**: Tree arrays use BigInt, be mindful of large trees

## Security Considerations

1. **No Private Keys**: SDK never handles private keys
2. **Input Validation**: Validate all user inputs
3. **Error Handling**: Never expose sensitive data in errors
4. **Dependencies**: Minimal, well-audited dependencies

## Future Enhancements

Potential features for future versions:
- [ ] Caching layer for freeze lists
- [ ] Batch proof generation
- [ ] Support for multiple programs
- [ ] WebAssembly optimization
- [ ] Browser localStorage integration
- [ ] GraphQL API support
- [ ] Websocket support for real-time updates
