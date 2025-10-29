# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2025-10-29

### Added

#### Transaction Tracking

- **`trackTransactionStatus()`**: New exported function for tracking Aleo transaction status with polling
  - Monitors transaction confirmation until accepted, rejected, or timeout
  - Configurable polling interval, timeout, and max attempts
  - Handles accepted transactions (execute/deploy), rejected transactions (fee-only), and pending states
  - Returns transaction status with type, confirmed/unconfirmed IDs, block height, and error messages
  - Implements best practices: exponential backoff, rate limiting (429), Retry-After header support
  - Integrated structured logging with Logger interface
- **Transaction Types**: New TypeScript types for transaction tracking
  - `TransactionStatus`: Complete transaction status with type and metadata
  - `TransactionStatusType`: Status enum (accepted | rejected | aborted | pending)
  - `TransactionType`: Transaction type (execute | deploy | fee)
  - `TransactionTrackingOptions`: Configuration options for tracking behavior

#### HTTP Utilities

- **`fetch-utils.ts`**: New shared utilities module for HTTP operations with retry logic
  - `calculateBackoff()`: Exponential backoff calculation with jitter to prevent thundering herd
  - `parseRetryAfter()`: RFC 7231 compliant Retry-After header parsing (seconds and HTTP-date formats)
  - `sleep()`: Promise-based delay utility for async operations
  - All utilities exported for external use

### Changed

#### API Client Improvements

- **Refactored AleoAPIClient**: Eliminated code duplication by using shared fetch utilities
  - Now uses `calculateBackoff()`, `parseRetryAfter()`, and `sleep()` from fetch-utils
  - Removed ~50 lines of duplicate retry logic
  - Maintains same functionality with improved maintainability

#### Transaction Tracker Improvements

- **Enhanced Best Practices**: Transaction tracker now implements production-ready HTTP patterns
  - Rate limiting (429) detection and retry with exponential backoff
  - Retry-After header parsing and respect (both seconds and HTTP-date formats)
  - Smart error handling (only retry transient errors: 5xx, 429, network errors)
  - Non-retryable client errors (4xx except 404, 429) fail immediately
  - Exponential backoff with jitter for all retry scenarios

#### Documentation

- **Updated README**: Added comprehensive "Transaction Tracking" section
  - Usage examples with default and custom configurations
  - Type definitions for all transaction tracking types
  - Status handling patterns and best practices

### Testing

- **Transaction Tracker Tests**: 19 comprehensive tests covering all scenarios
  - Successful transactions (execute and deploy types)
  - Rejected transactions (fee-only transactions)
  - Polling behavior (404 → success transitions)
  - Rate limiting (429) with exponential backoff and Retry-After headers
  - Error handling (client errors, server errors, network failures)
  - Timeout handling (overall timeout and per-request timeout)
  - Block height fetching and validation
  - Logger integration and structured logging
- **Fetch Utils Tests**: 19 comprehensive tests achieving 100% coverage
  - Exponential backoff calculation with jitter validation
  - Max delay cap enforcement
  - Custom base delay support
  - Retry-After header parsing (seconds, HTTP-date, invalid values)
  - Non-negative delay enforcement for past dates
  - Sleep utility with fake timers
  - Coverage: 100% statements, 100% branches, 100% functions, 100% lines
- **Coverage Improvements**: Excluded type-only files from coverage reporting
  - Added `src/types.ts` to coverage exclusion list
  - Overall SDK coverage maintained above 94%

### Removed

- **Moved from Examples**: Transaction tracker moved from examples into SDK core
  - Deleted `examples/aleo-transaction-tracker.ts` (now part of SDK)
  - Updated `examples/verify-non-inclusion-transaction.ts` to import from SDK

## [0.1.0] - 2025-10-16

Initial release of the Policy Engine SDK for Aleo blockchain compliance operations.

**Published to**: npm registry and GitHub Packages (manual publication)

**Note**: Future releases will use automated Changesets workflow.

### Added

#### Core SDK Features

- **PolicyEngine Class**: Main SDK interface for generating Merkle proofs and interacting with Aleo compliance policies
  - `fetchCurrentRoot()`: Lightweight method to fetch only the Merkle root for cache validation
  - `fetchFreezeListFromChain()`: Query on-chain freeze list with parallel batch fetching
  - `generateFreezeListNonInclusionProof()`: Generate non-inclusion proofs for privacy-preserving compliance
  - `buildMerkleTree()`: Build complete Merkle tree from addresses
  - `getMerkleRoot()`: Compute Merkle root from address list
  - `getConfig()`: Retrieve current SDK configuration

#### Blockchain Integration

- **AleoAPIClient**: Robust HTTP client for Aleo network interaction
  - Automatic retry logic with exponential backoff (configurable: default 5 retries with 2s delay)
  - Controlled concurrency for batch operations (default: 10 concurrent requests)
  - JSON-quoted response handling for Aleo API compatibility
  - Graceful error handling with detailed error messages
  - Network endpoint support (mainnet, testnet, custom devnet)

#### Merkle Tree Utilities

- `buildTree()`: Construct complete Merkle tree with Poseidon hash
- `generateLeaves()`: Sort and pad addresses to power-of-2 for tree building
- `getLeafIndices()`: Find adjacent leaf indices for non-inclusion proofs
- `getSiblingPath()`: Generate Merkle proof (sibling path) for verification
- `ZERO_ADDRESS`: Constant for Aleo zero address padding (`aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc`)

#### Conversion Utilities

- `convertAddressToField()`: Convert Aleo bech32m address to field element
- `convertFieldToAddress()`: Convert field element to Aleo bech32m address
- `stringToBigInt()`: Convert ASCII strings to BigInt (for token names, symbols)

#### Logging

- **Configurable Logger**: Custom logger support with log levels (debug, info, warn, error)
- `defaultLogger`: Built-in console logger with timestamps
- `silentLogger`: No-op logger for production environments

#### Configuration

- **PolicyEngineConfig**: Comprehensive configuration options
  - `endpoint`: Network endpoint (default: `https://api.explorer.provable.com/v1` for mainnet)
  - `network`: Network name (mainnet/testnet)
  - `maxTreeDepth`: Merkle tree depth (default: 15, supports 2^14 = 16,384 leaves)
  - `maxRetries`: API retry attempts (default: 5)
  - `retryDelay`: Delay between retries (default: 2000ms)
  - `maxConcurrency`: Parallel HTTP requests (default: 10)
  - `logger`: Custom logger function

#### TypeScript Support

- Full TypeScript definitions with declaration files (.d.ts)
- Exported types:
  - `MerkleProof`: Merkle proof structure with siblings and leaf index
  - `PolicyEngineConfig`: SDK configuration options
  - `FreezeListResult`: Freeze list fetch result with addresses, lastIndex, and currentRoot
  - `NonInclusionProofOptions`: Options for proof generation (freezeList or programId)
  - `NonInclusionWitness`: Complete witness with two proofs, root, and freeze list
  - `Logger`: Logger function type
  - `LogLevel`: Log level type (debug | info | warn | error)

#### Examples

- **basic-usage.ts**: Fundamental SDK features and proof generation
- **cached-freeze-list.ts**: Production-ready caching pattern with root validation
- **verify-non-inclusion-transaction.ts**: Complete transaction submission workflow using @provablehq/sdk
- **aleo-transaction-tracker.ts**: Utility for tracking transaction status with configurable polling and timeout

#### Documentation

- Comprehensive README with API reference, usage examples, and best practices
- Quick Start guide for 5-minute setup
- Development guide with npm workspaces workflow and publishing instructions
- Test suite documentation with coverage requirements
- Examples documentation with setup instructions

#### Testing

- Vitest-based unit test suite with 80%+ coverage requirement
- Tests for all core functionality:
  - Address conversion (round-trip, edge cases, boundary values, error handling)
  - Merkle tree operations (tree building, proof generation, leaf indices, sorting)
  - API client (retry logic, exponential backoff, rate limiting, error handling, batch operations)
  - PolicyEngine (all public methods, integration scenarios, cache validation)
- V8 coverage provider with HTML, JSON, and LCOV reports
- GitHub Actions CI integration

### Features

- **Zero-Knowledge Compliance**: Generate non-inclusion proofs for privacy-preserving compliance verification
- **Program Agnostic**: Works with any Aleo program implementing the freeze list API:
  - `mapping freeze_list_index: u32 => address`
  - `mapping freeze_list_last_index: bool => u32`
  - `mapping freeze_list_root: u8 => field`
- **Multi-Program Support**: Single SDK instance can query multiple compliance programs
- **Performance Optimized**: Root validation pattern minimizes API calls and tree rebuilding
- **Cache-Friendly**: `fetchCurrentRoot()` enables efficient cache validation with single API call
- **Production Ready**: Comprehensive error handling, retry logic, and configurable logging
- **ESM Only**: Modern ES module targeting Node.js 20+
- **Minimal Dependencies**: Only `@provablehq/sdk` and `@scure/base` as runtime dependencies
- **Dual Registry Support**: Published to both npm registry and GitHub Packages

### Development

- npm workspaces setup for monorepo integration
- Prettier formatting (120 char line width, 2 spaces, trailing commas)
- GitHub Actions CI with format checks and test coverage
- TypeScript 5.8+ with strict mode enabled
- Vitest 3.1+ for testing with coverage reporting

[0.1.1]: https://www.npmjs.com/package/@sealance-io/policy-engine-aleo/v/0.1.1
[0.1.0]: https://www.npmjs.com/package/@sealance-io/policy-engine-aleo/v/0.1.0
