# Test Suite

Unit tests for `@sealance-io/policy-engine-aleo` SDK.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## Test Structure

### `conversion.test.ts`
Tests for address ↔ field conversion utilities:
- Round-trip conversions (address → field → address)
- Special cases (zero, small, large field values)
- Error handling for invalid inputs
- Format validation
- Multiple conversion cycles
- `stringToBigInt` utility

### `merkle-tree.test.ts`
Tests for Merkle tree operations:
- `genLeaves`: Leaf generation, sorting, padding
- `buildTree`: Tree construction, validation
- `getLeafIndices`: Finding indices for non-inclusion proofs
- `getSiblingPath`: Generating Merkle proofs
- Integration tests for complete proof generation

### `api-client.test.ts`
Tests for Aleo API client:
- Configuration initialization
- Mapping fetches from blockchain
- Retry logic with exponential backoff
- Error handling (404, network errors, HTTP errors)
- URL construction

### `policy-engine.test.ts`
Tests for main PolicyEngine class:
- Configuration and initialization
- `buildMerkleTree`: Tree building from addresses
- `getMerkleRoot`: Root computation
- `fetchFreezeListFromChain`: Blockchain data fetching
- `generateNonInclusionProof`: Complete proof generation

## Coverage

The test suite aims for 80% coverage across:
- Lines
- Functions
- Branches
- Statements

Coverage reports are generated in `coverage/` directory:
- `coverage/index.html`: HTML report (open in browser)
- `coverage/coverage-final.json`: JSON report
- `coverage/lcov.info`: LCOV format (for CI/CD)

## Test Configuration

See `vitest.config.ts` for configuration:
- Timeout: 30 seconds per test
- Coverage provider: V8
- Environment: Node.js
- Globals: Enabled (describe, it, expect)

## Mocking

Tests use Vitest's built-in mocking:
- `vi.fn()`: Mock functions
- `vi.mock()`: Module mocking
- `global.fetch`: Mocked for API calls

Example:
```typescript
import { vi } from "vitest";

const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  text: async () => "result"
});

global.fetch = mockFetch;
```

## Best Practices

1. **Isolated Tests**: Each test is independent
2. **Clear Descriptions**: Use descriptive test names
3. **Arrange-Act-Assert**: Follow AAA pattern
4. **Mock External Calls**: Don't call real blockchain
5. **Test Edge Cases**: Cover boundaries and errors
6. **Fast Tests**: Unit tests should run quickly

## Adding New Tests

1. Create test file: `test/your-module.test.ts`
2. Import test utilities:
   ```typescript
   import { describe, it, expect, vi, beforeEach } from "vitest";
   ```
3. Follow existing test patterns
4. Run tests: `npm test`
5. Check coverage: `npm run test:coverage`

## CI/CD Integration

Tests can be integrated into CI/CD pipelines:

```yaml
# GitHub Actions example
- name: Run tests
  run: npm test

- name: Generate coverage
  run: npm run test:coverage

- name: Upload coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/lcov.info
```

## Future Tests

Planned additions:
- Integration tests with real devnet
- Performance benchmarks
- Fuzz testing for address/field conversions
- Property-based testing for Merkle trees
