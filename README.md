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
      `npm ci`

2. **Install doko-js CLI**
[Jump to Installation Guide](docs/doko-installation-guide.md)

4. **Build the Contracts**  
    - `dokojs compile`

## Run Tests  
   - **Run devnet** 
   `./devnet.sh` following instructions from snarkOS https://github.com/ProvableHQ/snarkOS/blob/staging/devnet.sh`
   
   - **Run tests**
   `npm test` or `npm run test:select compliant`

## Contributing

Contributions are welcome. Please create pull requests with detailed descriptions and adhere to the repository's coding guidelines.

## License

This repository is licensed under the Apache License, Version 2.0.  
See the [LICENSE](./LICENSE) file for details.
