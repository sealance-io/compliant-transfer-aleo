#!/usr/bin/env bash

# Enable strict mode
set -euo pipefail
IFS=$'\n\t'

# Default values for repository and branch
DEFAULT_REPO="https://github.com/venture23-aleo/doko-js.git"
DEFAULT_BRANCH="v0.0.2"
REPO="$DEFAULT_REPO"
BRANCH="$DEFAULT_BRANCH"

# Function to display usage instructions
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo "Options:"
    echo "  -r, --repo REPO_URL     Git repository URL (default: $DEFAULT_REPO)"
    echo "  -b, --branch BRANCH     Git branch or tag (default: $DEFAULT_BRANCH)"
    echo "  -h, --help              Display this help message"
    exit 0
}

# Function to display error messages
error() {
    echo "ERROR: $1" >&2
    exit 1
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check for required dependencies
check_dependencies() {
    echo "Checking dependencies..."
    
    local missing_deps=()
    
    if ! command_exists cargo; then
        missing_deps+=("Rust/Cargo")
    fi
    
    if ! command_exists wasm-pack; then
        missing_deps+=("wasm-pack")
    fi
    
    if ! rustup target list | grep "wasm32-unknown-unknown (installed)" > /dev/null; then
        missing_deps+=("wasm32-unknown-unknown target")
    fi
    
    if ! command_exists pnpm; then
        missing_deps+=("pnpm version 10")
    else
        pnpm_version=$(pnpm --version)
        major_version="${pnpm_version%%.*}"
        if [[ "$major_version" != "10" ]]; then
            missing_deps+=("pnpm version 10 (current: $pnpm_version)")
        fi
    fi
    
    if ! command_exists git; then
        missing_deps+=("git")
    fi
    
    if ! command_exists node; then
        missing_deps+=("Node.js version 22")
    else
        NODE_VERSION=$(node --version | cut -c 2- | cut -d. -f1)
        if [ "$NODE_VERSION" -lt 22 ]; then
            echo "Warning: Node.js version $NODE_VERSION is lower than the recommended version 22."
        fi
    fi
    
    if [ ${#missing_deps[@]} -gt 0 ]; then
        echo "Missing required dependencies:"
        for dep in "${missing_deps[@]}"; do
            echo "  - $dep"
        done
        error "Please install the missing dependencies and try again."
    fi
    
    echo "All dependencies are satisfied."
}

# Setup Node.js with nvm if available
setup_node() {
    if [ -s "$HOME/.nvm/nvm.sh" ]; then
        echo "Loading nvm..."
        export NVM_DIR="$HOME/.nvm"
        . "$NVM_DIR/nvm.sh"
        
        if [ -f ".nvmrc" ]; then
            echo "Found .nvmrc, using specified Node.js version..."
            nvm use || nvm install
        else
            echo "Using Node.js version 22..."
            nvm use 22 || nvm install 22
        fi
    fi
}

# Simple lint bypass for pnpm
create_lint_bypass() {
    pnpm() {
        if [ "$1" = "lint" ]; then
            echo "Skipping lint step..."
            return 0
        else
            command pnpm "$@"
        fi
    }
    export -f pnpm
}

# Main installation function
install_doko_cli() {
    # Check dependencies
    check_dependencies
    
    # Define installation directory
    INSTALL_DIR="$HOME/.doko-js-cli"
    echo "Installation directory: $INSTALL_DIR"
    
    # Remove existing installation if present
    if [ -d "$INSTALL_DIR" ]; then
        echo "Removing existing installation..."
        rm -rf "$INSTALL_DIR"
    fi
    
    # Create installation directory
    mkdir -p "$INSTALL_DIR"
    
    # Clone repository directly to installation directory
    echo "Cloning repository to $INSTALL_DIR..."
    git clone -b "$BRANCH" --single-branch --depth 1 "$REPO" "$INSTALL_DIR"
    
    # Change to installation directory
    cd "$INSTALL_DIR"
    
    # Setup Node.js environment
    setup_node
    
    # Install dependencies with pnpm
    echo "Installing dependencies with pnpm..."
    pnpm install
    
    # Create lint bypass
    create_lint_bypass
    
    # Build the project
    echo "Building project with pnpm..."
    pnpm run build
    
    # Uninstall existing CLI if present
    echo "Removing any existing CLI installation..."
    npm uninstall -g @doko-js/cli 2>/dev/null || true
    
    # Install CLI globally using project script
    echo "Installing CLI globally..."
    npm run install:cli
    
    # Test the installation
    DOKOJS_BIN_PATH="$(npm bin -g)/dokojs"
    echo "Testing installation..."
    if "$DOKOJS_BIN_PATH" --help >/dev/null 2>&1 || "$DOKOJS_BIN_PATH" --version >/dev/null 2>&1; then
        echo "✅ Success! The dokojs command is working correctly."
    else
        echo "⚠️ The dokojs command does not seem to be working."
        echo "Please try running 'dokojs --help' in a new terminal session."
    fi
    
    echo "Doko CLI installation completed. Try running 'dokojs --help'."
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        -r|--repo)
            REPO="$2"
            shift 2
            ;;
        -b|--branch)
            BRANCH="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use -h or --help for usage information."
            exit 1
            ;;
    esac
done

# Run the installation
install_doko_cli