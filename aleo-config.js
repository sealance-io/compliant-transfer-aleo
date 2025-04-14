import dotenv from 'dotenv';
dotenv.config();

export default {
  accounts: [process.env.ALEO_PRIVATE_KEY],
  mode: 'execute',
  mainnet: {},
  networks: {
    testnet: {
      endpoint: process.env.TESTNET_ENDPOINT ?? 'http://localhost:3030',
      accounts: [
        process.env.ALEO_DEVNET_DEPLOYER_PRIVATE_KEY,
        process.env.ALEO_DEVNET_ADMIN_PRIVATE_KEY,
        process.env.ALEO_DEVNET_INVESTIGATOR_PRIVATE_KEY,
        process.env.ALEO_DEVNET_FREEZED_ADDRESS_PRIVATE_KEY,
        process.env.ALEO_DEVNET_SENDER_PRIVATE_KEY,
        process.env.ALEO_DEVNET_RECIPIENT_PRIVATE_KEY
      ],
      priorityFee: 0.01
    },
    mainnet: {
      endpoint: 'https://api.explorer.aleo.org/v1',
      accounts: [process.env.ALEO_PRIVATE_KEY_MAINNET],
      priorityFee: 0.001
    }
  },
  defaultNetwork: 'testnet'
};
