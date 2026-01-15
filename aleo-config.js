import dotenv from "dotenv";
dotenv.config({ quiet: true });

/**
 * @typedef {Object} NetworkConfig
 * @property {string} endpoint - The API endpoint URL for the network
 * @property {string[]} accounts - Array of Aleo private keys for this network
 * @property {number} priorityFee - The transaction priority fee for this network
 */

/**
 * @typedef {Object} AleoConfig
 * @property {string[]} accounts - Default accounts to use across all networks
 * @property {'execute'|'prove'|'deploy'} mode - Execution mode for Aleo operations
 * @property {Object} mainnet - Global mainnet configuration
 * @property {Object.<string, NetworkConfig>} networks - Network-specific configurations
 * @property {NetworkConfig} networks.testnet - Testnet network configuration
 * @property {NetworkConfig} networks.mainnet - Mainnet network configuration
 * @property {'testnet'|'mainnet'} defaultNetwork - The default network to use
 */

/** @type {AleoConfig} */
export default {
  accounts: [process.env.ALEO_PRIVATE_KEY],
  mode: "execute",
  mainnet: {},
  networks: {
    testnet: {
      endpoint: process.env.TESTNET_ENDPOINT ?? "http://localhost:3030",
      accounts: [
        process.env.ALEO_DEVNET_DEPLOYER_PRIVATE_KEY,
        process.env.ALEO_DEVNET_ADMIN_PRIVATE_KEY,
        process.env.ALEO_DEVNET_INVESTIGATOR_PRIVATE_KEY,
        process.env.ALEO_DEVNET_FROZEN_ADDRESS_PRIVATE_KEY,
        process.env.ALEO_DEVNET_SENDER_PRIVATE_KEY,
        process.env.ALEO_DEVNET_RECIPIENT_PRIVATE_KEY,
        process.env.ALEO_DEVNET_MINTER_PRIVATE_KEY,
        process.env.ALEO_DEVNET_BURNER_PRIVATE_KEY,
        process.env.ALEO_DEVNET_SUPPLY_MANAGER_PRIVATE_KEY,
        process.env.ALEO_DEVNET_SPENDER_PRIVATE_KEY,
        process.env.ALEO_DEVNET_FREEZE_LIST_MANAGER_PRIVATE_KEY,
        process.env.ALEO_DEVNET_PAUSER_PRIVATE_KEY,
        process.env.ALEO_DEVNET_SIGNER1_PRIVATE_KEY,
        process.env.ALEO_DEVNET_SIGNER2_PRIVATE_KEY,
      ],
      priorityFee: 0.01,
    },
    mainnet: {
      endpoint: "https://api.explorer.aleo.org/v1",
      accounts: [process.env.ALEO_PRIVATE_KEY_MAINNET],
      priorityFee: 0.001,
    },
  },
  defaultNetwork: "testnet",
};
