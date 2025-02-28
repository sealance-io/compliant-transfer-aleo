# Compliant Transfer - Aleo Projects

This repository contains smart contracts, tests, and auxiliary scripts for implementing compliant transfer functionalities using the Aleo blockchain.

## Repository Structure

- **/programs**: Aleo smart contracts (e.g., merkle_tree8.leo, rediwsozfo.leo, etc.)
- **/artifacts**: Compiled artifacts and JS bindings for interacting with contracts.
- **/test**: TypeScript tests that validate contract functionalities.
- **/imports**: Shared modules and additional contracts (e.g., token_registry.aleo).

## Getting Started

1. **Install Dependencies**  
   - Navigate to the repository root and run:  
      `npm install`

2. **Install dokojs globally using npm** https://github.com/venture23-aleo/doko-js
      `npm install -g @doko-js/cli@latest`

3. **Install a patch fixing limitation in doko-js** (until this PR is merged https://github.com/venture23-aleo/doko-js/pull/40)
      `git clone https://github.com/venture23-aleo/doko-js`

      `cd doko-js`

      `pnpm install`

      `npm run build`

      `npm run install:cli`

4. **Build the Contracts**  
    - `dokojs compile`

5. **Run Tests**  
   Execute tests with:  
   `npm test` or `npm run test:select compliant`

## Contributing

Contributions are welcome. Please create pull requests with detailed descriptions and adhere to the repository's coding guidelines.

## License

This repository is licensed under the Apache License, Version 2.0.  
See the [LICENSE](./LICENSE) file for details.