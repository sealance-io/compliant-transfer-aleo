import dotenv from "dotenv";
import { configVariable, defineConfig } from "@lionden/config";
import pluginDeploy from "@lionden/plugin-deploy";
import pluginLeo from "@lionden/plugin-leo";
import pluginNetwork from "@lionden/plugin-network";
import pluginTest from "@lionden/plugin-test";

dotenv.config({ quiet: true });

export default defineConfig({
  plugins: [pluginLeo, pluginNetwork, pluginDeploy, pluginTest],
  leoVersion: "4.2.0",
  defaultNetwork: "devnode",
  networks: {
    devnode: {
      type: "devnode",
      network: "testnet",
      autoBlock: true,
      provider: "leo",
      consensusHeights: "0,1,2,3,4,5,6,7,8,9,10,11,12,13",
      privateKey: configVariable(
        "ALEO_DEVNET_DEPLOYER_PRIVATE_KEY",
        "APrivateKey1zkp8CZNn3yeCseEtxuVPbDCwSyhGW6yZKUYKfgXmcpoGPWH",
      ),
    },
    testnet: {
      type: "http",
      endpoint: "https://api.explorer.provable.com/v1",
      network: "testnet",
      privateKey: configVariable(
        "ALEO_PRIVATE_KEY_TESTNET",
        "APrivateKey1zkp8CZNn3yeCseEtxuVPbDCwSyhGW6yZKUYKfgXmcpoGPWH",
      ),
    },
    mainnet: {
      type: "http",
      endpoint: "https://api.explorer.aleo.org/v1",
      network: "mainnet",
      privateKey: configVariable(
        "ALEO_PRIVATE_KEY_MAINNET",
        "APrivateKey1zkp8CZNn3yeCseEtxuVPbDCwSyhGW6yZKUYKfgXmcpoGPWH",
      ),
    },
  },
  namedAccounts: {
    deployer: {
      devnode: configVariable(
        "ALEO_DEVNET_DEPLOYER_PRIVATE_KEY",
        "APrivateKey1zkp8CZNn3yeCseEtxuVPbDCwSyhGW6yZKUYKfgXmcpoGPWH",
      ),
    },
    admin: {
      devnode: configVariable(
        "ALEO_DEVNET_ADMIN_PRIVATE_KEY",
        "APrivateKey1zkpGu1DmRgYYvQ3FmE2iXisTEDXYS2vDVLhbY3bTq8f7fv7",
      ),
    },
    investigator: {
      devnode: configVariable(
        "ALEO_DEVNET_INVESTIGATOR_PRIVATE_KEY",
        "APrivateKey1zkpBjpEgLo4arVUkQmcLdKQMiAKGaHAQVVwmF8HQby8vdYs",
      ),
    },
    frozenAccount: {
      devnode: configVariable(
        "ALEO_DEVNET_FROZEN_ADDRESS_PRIVATE_KEY",
        "APrivateKey1zkpAaWyA9Qcs6hQbVPJv6Wjh7eSzTnxrobhTGguSpfJX5jz",
      ),
    },
    account: {
      devnode: configVariable(
        "ALEO_DEVNET_SENDER_PRIVATE_KEY",
        "APrivateKey1zkp2RWGDcde3efb89rjhME1VYA8QMxcxep5DShNBR6n8Yjh",
      ),
    },
    recipient: {
      devnode: configVariable(
        "ALEO_DEVNET_RECIPIENT_PRIVATE_KEY",
        "APrivateKey1zkp2GUmKbVsuc1NSj28pa1WTQuZaK5f1DQJAT6vPcHyWokG",
      ),
    },
    minter: {
      devnode: configVariable(
        "ALEO_DEVNET_MINTER_PRIVATE_KEY",
        "APrivateKey1zkp9FL6oLk5e5unwQrXCz3PfDJPE1WM1W7psGm8edP5KRLL",
      ),
    },
    burner: {
      devnode: configVariable(
        "ALEO_DEVNET_BURNER_PRIVATE_KEY",
        "APrivateKey1zkpDigVA9KDuNh7ziQ6QD7CGSDdGCYxixtVDsuf4f1U2jZC",
      ),
    },
    supplyManager: {
      devnode: configVariable(
        "ALEO_DEVNET_SUPPLY_MANAGER_PRIVATE_KEY",
        "APrivateKey1zkpGt8jNxSYTRgoYM21NuRzp7ockeeGDmpnXpUEvGyNeNSS",
      ),
    },
    spender: {
      devnode: configVariable(
        "ALEO_DEVNET_SPENDER_PRIVATE_KEY",
        "APrivateKey1zkpFKQi2yiWf1P1McSz5DarAH1EVtWn96jzGsc57ddn4fT4",
      ),
    },
    freezeListManager: {
      devnode: configVariable(
        "ALEO_DEVNET_FREEZE_LIST_MANAGER_PRIVATE_KEY",
        "APrivateKey1zkp8EXvwBCw1Tic27Uz7sZiZPpsGosLmmHFS3uzWFVU9q4e",
      ),
    },
    pauser: {
      devnode: configVariable(
        "ALEO_DEVNET_PAUSER_PRIVATE_KEY",
        "APrivateKey1zkpB4jk2y5fQDAH7cq6p1SiqwMGhj88QsUVQsa5zbnNd6Ub",
      ),
    },
    signer1: {
      devnode: configVariable(
        "ALEO_DEVNET_SIGNER1_PRIVATE_KEY",
        "APrivateKey1zkp3ZrLvtBha1dKbgYHcLr3jiEFQXZR5f3PagKSb2EA7zPe",
      ),
    },
    signer2: {
      devnode: configVariable(
        "ALEO_DEVNET_SIGNER2_PRIVATE_KEY",
        "APrivateKey1zkpCKsb5i4wFyAuuZinJiW5Eru25aFLYE6ofJBwjQrxgqLB",
      ),
    },
  },
  testing: {
    timeout: 600_000_000,
  },
  deploy: {
    confirmTransactions: true,
    confirmationTimeout: 300_000,
  },

  codegen: {
    dynamicRecords: {
      asTokenRegistryRecord: {
        sourceRecord: "Token",
        sourceProgram: "token_registry.aleo",
        schema: {
          owner: "address.private",
          amount: "u128.private",
          token_id: "field.private",
          external_authorization_required: "boolean.private",
          authorized_until: "u32.private",
          _nonce: "group.public",
        },
      },
      asTimelockCompliantTokenRecord: {
        sourceRecord: "CompliantToken",
        sourceProgram: "sealed_timelock_policy.aleo",
        schema: {
          owner: "address.private",
          amount: "u128.private",
          locked_until: "u32.private",
          _nonce: "group.public",
        },
      },
    },
  },
});
