#!/usr/bin/env bash

# Enable strict mode
set -euo pipefail
IFS=$'\n\t'

# Default values for repository and branch
DEFAULT_REPO="https://github.com/venture23-aleo/doko-js.git"
DEFAULT_BRANCH="main"
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

# Add this function to check if npm global directory is writable
check_npm_permissions() {
    local npm_prefix
    npm_prefix=$(npm config get prefix)
    
    # Check if the npm global directories are writable
    if [ -w "$npm_prefix/bin" ] && [ -w "$npm_prefix/lib/node_modules" ]; then
        return 0  # Directories are writable
    else
        return 1  # Directories are not writable
    fi
}

# Check for required dependencies
check_dependencies() {
    echo "Checking dependencies..."
    
    local missing_deps=()
    
    # Check if Rust/Cargo is installed
    if ! command_exists cargo; then
        echo "Rust/Cargo is not installed."
        read -p "Would you like to install Rust using rustup? (y/n): " -r install_rust
        if [[ "$install_rust" =~ ^[Yy]$ ]]; then
            echo "Installing Rust using rustup..."
            curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
            # Source the cargo environment
            if [[ -f "$HOME/.cargo/env" ]]; then
                source "$HOME/.cargo/env"
            else
                error "Failed to find cargo environment after installation."
            fi
        else
            error "Rust/Cargo is required but not installed. Please install it manually."
        fi
    fi
    
    # Check if wasm-pack is installed (required for Rust to WASM builds)
    if ! command_exists wasm-pack; then
        echo "wasm-pack is not installed (required for Rust to WASM builds)."
        read -p "Would you like to install wasm-pack from crates.io? (y/n): " -r install_wasm_pack
        if [[ "$install_wasm_pack" =~ ^[Yy]$ ]]; then
            echo "Installing wasm-pack..."
            cargo install wasm-pack
        else
            error "wasm-pack is required but not installed. Please install it manually using 'cargo install wasm-pack'."
        fi
    fi
    
    # Ensure the Rust wasm32-unknown-unknown target is installed
    if ! rustup target list | grep "wasm32-unknown-unknown (installed)" > /dev/null; then
        echo "The wasm32-unknown-unknown target is not installed for Rust."
        read -p "Would you like to install it now? (y/n): " -r install_wasm_target
        if [[ "$install_wasm_target" =~ ^[Yy]$ ]]; then
            echo "Installing wasm32-unknown-unknown target..."
            rustup target add wasm32-unknown-unknown
        else
            error "The wasm32-unknown-unknown target is required but not installed. Please install it manually using 'rustup target add wasm32-unknown-unknown'."
        fi
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

create_wrapper_script() {
    # Create function override
    pnpm() {
        if [ "$1" = "lint" ]; then
            echo "Skipping lint step (function bypass)..."
            return 0
        else
            command pnpm "$@"
        fi
    }
    export -f pnpm
}

create_lint_bypass() {
    echo "Disabling lint step in package.json..."
    
    # Back up the original package.json
    if [ -f "package.json" ]; then
        cp package.json package.json.bak
        
        # Use a pipe character as delimiter instead of forward slash
        # This avoids issues with paths containing forward slashes
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS version needs an empty string with -i
            sed -i '' 's|pnpm lint && ||' package.json
        else
            # Linux version
            sed -i 's|pnpm lint && ||' package.json
        fi
        
        # Verify the change worked
        if grep -q "pnpm lint &&" package.json; then
            echo "Warning: Could not remove lint step from package.json. Creating wrapper script instead."
            cp package.json.bak package.json  # Restore original file
            create_wrapper_script  # Call our fallback function
        else
            echo "Successfully removed lint step from build script in package.json."
        fi
    else
        echo "Warning: package.json not found. Creating wrapper script instead."
        create_wrapper_script  # Call our fallback function
    fi
}

# Add this function to handle CLI installation with proper permissions
install_cli_globally() {
    echo "Installing CLI globally..."
    
    if check_npm_permissions; then
        # No sudo needed, directories are writable
        npm run install:cli
        return $?
    else
        echo "The npm global directories are not writable by the current user."
        echo "You have several options:"
        echo "  1. Run with sudo (requires admin password)"
        echo "  2. Configure npm to use a user-writable location"
        echo "  3. Skip global installation (abort)"
        read -rp "Choose an option (1/2/3): " choice
        
        case "$choice" in
            1)
                echo "Installing with sudo..."
                sudo npm run install:cli
                ;;
            2)
                echo "Configuring npm to use a user-writable location..."
                mkdir -p "$HOME/.npm-global"
                npm config set prefix "$HOME/.npm-global"
                export PATH="$HOME/.npm-global/bin:$PATH"
                
                echo "Installing CLI to user location..."
                npm run install:cli
                
                echo "✅ Installation complete!"
                echo ""
                echo "IMPORTANT: To make the CLI available in all terminal sessions, add this line to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
                echo "  export PATH=\"$HOME/.npm-global/bin:\$PATH\""
                ;;
            3)
                echo "Skipping global installation."
                return 0
                ;;
            *)
                echo "Invalid option. Skipping global installation."
                return 1
                ;;
        esac
    fi
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
    echo "Checking for existing CLI installation..."
    if check_npm_permissions; then
        npm uninstall -g @doko-js/cli 2>/dev/null || true
    else
        echo "Note: Cannot automatically uninstall previous global version due to permissions."
        echo "If you need to remove a previous version, you may need to use sudo."
    fi

    # Install CLI globally with appropriate permissions
    install_cli_globally
    
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