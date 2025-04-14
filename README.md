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
[Jump to Installation Guide](#installing-the-doko-js-cli)

4. **Build the Contracts**  
    - `dokojs compile`

## Run Tests  
   - **Run devnet** 
   `./devnet.sh` following instructions from snarkOS https://github.com/ProvableHQ/snarkOS/blob/staging/devnet.sh`
   
   - **Run tests**
   `npm test` or `npm run test:select compliant`

## Installing the Doko-JS CLI

There are three ways to install the Doko-JS CLI:

### Option 1: Using the Installation Script (Recommended)

We provide a script that handles all the build steps and dependencies for you. This script lets you build the CLI from any repository and branch, which is particularly useful when you need a version with specific fixes.

#### Prerequisites for the Script

- Node.js (version 22 recommended)
- Rust and Cargo
- wasm-pack
- pnpm (version 10)
- git

#### Running the Installation Script

To install using the default repository and version:

```bash
./build_dokojs_cli.sh
```

The default settings use:
- Repository: https://github.com/venture23-aleo/doko-js.git
- Branch: v0.0.2

To install from a custom repository or branch (for example, to use a patched version):

```bash
./build_dokojs_cli.sh -r "https://github.com/NadavPeled1998/doko-js.git" -b "fix/array_type_conversion"
```

After the installation completes, you can use the CLI by running `dokojs` commands in your terminal.

### Option 2: Manual Installation from Source

If you prefer to handle the installation steps yourself, you can follow these instructions:

#### Prerequisites

- Node.js (version 22 recommended)
- Rust and Cargo (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- wasm-pack (`cargo install wasm-pack`)
- wasm32-unknown-unknown target (`rustup target add wasm32-unknown-unknown`)
- pnpm version 10 (`npm install -g pnpm@10`)
- git

#### Step-by-Step Manual Installation

1. Clone the repository:
   ```bash
   git clone -b fix/array_type_conversion https://github.com/NadavPeled1998/doko-js.git
   cd doko-js
   ```

Or the unpathced origin:
   ```bash
   git clone -b v0.0.2 https://github.com/venture23-aleo/doko-js.git
   cd doko-js
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build the project:
   ```bash
   pnpm run build
   ```

4. Install the CLI globally:
   ```bash
   npm run install:cli
   ```

5. Verify the installation:
   ```bash
   dokojs --help
   ```

### Option 3: Install from NPM (Simplest)

If you just want the latest published version, you can install directly from npm:

```bash
npm install -g @doko-js/cli@latest
```

This is the simplest approach, but it won't include any unreleased fixes that might be available in specific branches or forks.

### Troubleshooting

If you encounter issues with the CLI after installation:

1. Make sure the npm bin directory is in your PATH
2. Start a new terminal session to ensure environment variables are refreshed
3. If using nvm on macOS, you might need to reinstall Node.js global packages after switching Node versions

For more detailed help, check the [Doko-JS repository issues](https://github.com/venture23-aleo/doko-js/issues) or submit a new issue.

## Contributing

Contributions are welcome. Please create pull requests with detailed descriptions and adhere to the repository's coding guidelines.

## License

This repository is licensed under the Apache License, Version 2.0.  
See the [LICENSE](./LICENSE) file for details.
