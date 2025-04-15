# Doko-JS CLI Installation Guide

This guide covers different methods to install the Doko-JS CLI tool, which allows you to interact with Doko-JS functionality from the command line.

## Overview

There are three ways to install the Doko-JS CLI, depending on your needs:

| Method | Best For | Prerequisites |
|--------|----------|---------------|
| **Installation Script** | Most users | git, curl, Node.js, minimal setup effort |
| **Manual Installation** | Developers, customization | Full development environment |
| **NPM Installation** | Quick testing, stable releases only | Node.js, npm |

## Option 1: Using the Installation Script (Recommended)

Our installation script handles **some** dependencies and build steps automatically, making it the simplest way to get started with the CLI.

### Prerequisites

The script will check for and help install most dependencies, but you'll need:
- git
- curl
- Node.js (version 22 recommended)
- pnpm version 10

### Running the Installation Script

To install using the default repository and version:

```bash
./build_dokojs_cli.sh
```

The default settings use:
- Repository: https://github.com/venture23-aleo/doko-js.git
- Branch: main

### Custom Installation Sources

To install from a custom repository or branch (for example, to use a patched version):

```bash
./build_dokojs_cli.sh -r "https://github.com/NadavPeled1998/doko-js.git" -b "fix/array_type_conversion"
```

After the installation completes, you can use the CLI by running `dokojs` commands in your terminal.

## Option 2: Manual Installation from Source

If you prefer to handle the installation steps yourself or need more control over the build process:

### Prerequisites

- git
- Node.js (version 22 recommended)
- Rust and Cargo (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- wasm-pack (`cargo install wasm-pack`)
- wasm32-unknown-unknown target (`rustup target add wasm32-unknown-unknown`)
- pnpm version 10 (`npm install -g pnpm@10`)

### Step-by-Step Manual Installation

1. Clone the repository:
   ```bash
   git clone -b main https://github.com/venture23-aleo/doko-js.git
   cd doko-js
   ```

   Or for a patched version:
   ```bash
   git clone -b fix/array_type_conversion https://github.com/NadavPeled1998/doko-js.git
   cd doko-js
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Install the CLI globally:
   ```bash
   npm run install:cli
   ```

5. Verify the installation:
   ```bash
   dokojs --help
   ```

## Option 3: Install from NPM (Simplest)

> ⚠️ **Note:** This method only provides the latest published release and won't include any unreleased fixes that might be available in specific branches or forks.

If you just want the latest published version, you can install directly from npm:

```bash
npm install -g @doko-js/cli@latest
```

## Troubleshooting

If you encounter issues with the CLI after installation:

1. **Path Issues**: Make sure the npm bin directory is in your PATH
2. **Environment Variables**: Start a new terminal session to ensure environment variables are refreshed
3. **Node Version Conflicts**: If using nvm on macOS, you might need to reinstall Node.js global packages after switching Node versions
4. **Permission Errors**: On Linux, you might need to use `sudo` for global installations or configure npm to use a user-writable location

### Permission Solutions

If you encounter permission errors during global installation:

```bash
# Option 1: Use sudo (requires admin password)
sudo npm install -g @doko-js/cli

# Option 2: Configure npm to use a user-writable location
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
export PATH=~/.npm-global/bin:$PATH
# Add the PATH line to your .bashrc or .zshrc file to make it permanent
```

For more detailed help, check the [Doko-JS repository issues](https://github.com/venture23-aleo/doko-js/issues) or submit a new issue.

## Platform-Specific Notes

### macOS
- The installation script works on both Intel and Apple Silicon Macs
- No sudo permissions are typically required

### Linux
- The installation script has been thoroughly tested on Debian, Ubuntu, and Fedora distributions
- Different distributions may require different permissions for npm global packages
- The installation script will guide you through permission options if needed
- On some distributions, you may need to manually add npm bin directories to your PATH if not automatically done

### Windows
- **Important:** This installation script does not support Windows natively
- For Windows 10/11 users, you can use Windows Subsystem for Linux (WSL)