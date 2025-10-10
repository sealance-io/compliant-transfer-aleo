# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **API Response Parsing**: Improved `fetchWithRetries` in `AleoAPIClient` to properly handle JSON-encoded responses from Aleo API
  - Now correctly parses JSON-quoted strings (e.g., `"value"` → `value`)
  - Handles null responses (`null` string, empty strings)
  - Gracefully falls back to raw text if JSON parsing fails
  - Removes redundant quote-stripping logic from `PolicyEngine`

### Added
- Comprehensive unit tests for API response parsing edge cases
- Tests for JSON-quoted responses, null handling, and empty responses

## [0.1.0] - 2024-10-09

### Added
- Initial release of @sealance-io/policy-engine-aleo SDK
- `PolicyEngine` class for high-level operations
- `AleoAPIClient` for blockchain data fetching with retry logic
- Merkle tree utilities: `buildTree`, `genLeaves`, `getLeafIndices`, `getSiblingPath`
- Address conversion utilities: `convertAddressToField`, `convertFieldToAddress`
- `fetchFreezeListFromChain()` method to query on-chain freeze lists
- `genNonInclusionProof()` method to generate non-inclusion proofs
- Full TypeScript support with declaration files
- Comprehensive documentation and examples
- ESM-only module targeting Node.js 20+ and modern browsers
- Vitest-based unit test suite with V8 coverage

### Features
- Zero-knowledge proof generation for compliance policies
- Privacy-preserving non-inclusion proofs
- Configurable Merkle tree depth and retry logic
- Efficient tree building with sorted, padded leaves
- Support for multiple Aleo networks (testnet, mainnet)

[Unreleased]: https://github.com/sealance-io/compliant-transfer-aleo/compare/policy-engine-sdk-v0.1.0...HEAD
[0.1.0]: https://github.com/sealance-io/compliant-transfer-aleo/releases/tag/policy-engine-sdk-v0.1.0
