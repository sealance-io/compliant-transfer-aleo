import credits.aleo;
import token_registry.aleo;
import sealed_timelock_policy.aleo;
import multisig_core.aleo;

struct ChecksumEdition {
    checksum: [u8; 32],
    edition: u16,
}

// The 'exchange' program.
// This is a simple exchange program to demonstrate the complaint tokens capabilities. It is intended only for Aleo testnet
program gqrfmwbtyp.aleo {
    @custom
    constructor() {
        // Only require multisig for upgrades - initial deployment has no checks.
        if self.edition > 0u16 {
            let signing_op_id = BHP256::hash_to_field(ChecksumEdition { checksum: self.checksum, edition: self.edition });

            let wallet_signing_op_id_hash = BHP256::hash_to_field(multisig_core.aleo::WalletSigningOpId { wallet_id: self.address, signing_op_id: signing_op_id });
            let signing_complete = multisig_core.aleo::completed_signing_ops.contains(wallet_signing_op_id_hash);
            assert(signing_complete);
        }
    }

    // The address that received the Aleo credits in the swap
    const TREASURY_ADDRESS: address = aleo1lwa86hr7qx99d7e3dcyv2s7wt9g8rmd6qxzm5zprad0c4ejynsqqvaxysn;
    // The rate that we will use in case there is no defined rate.
    const DEFAULT_RATE: u128 = 10u128;
    const TIMELOCK_TOKEN_ID: field = 31155203188273609789785737924444174490841009372087129field;
    const INITIAL_CONFIGURATION_ADDRESS: address = aleo1mh7al4qsedqvsh64pmmlcmzl5ugmrdxp4a4rdneja7etn8cpuspqvrj9q8;


    const INITIALIZED_INDEX: bool = true;
    // Indicates whether an address is frozen.
    mapping initialized: bool => bool;

    // Maps a token ID to its exchange rate relative to Aleo credits.
    // Used to calculate how many tokens a user receives per credit.
    // received_tokens = sent_credits * token_rates[token_id]
    mapping token_rates: field => u128;
    // Maps a role to an address.
    // This program defines only one role: the admin.
    const NONE_ROLE: u16 = 0u16;
    const MANAGER_ROLE: u16 = 8u16; // can only assign roles
    mapping address_to_role: address => u16;

    // Initializes the admin
    // Can only be called once -- ensures the contract has not already been initialized.
    // Can be called only by the INITIAL_CONFIGURATION_ADDRESS
    fn initialize(public admin: address) -> Final {
        let caller: address = self.caller;
        return final {
            let is_already_initialized: bool = initialized.get_or_use(INITIALIZED_INDEX, false);
            assert_eq(is_already_initialized, false);

            initialized.set(INITIALIZED_INDEX, true);

            // Only the INITIAL_CONFIGURATION_ADDRESS can initialize the contract
            assert_eq(caller, INITIAL_CONFIGURATION_ADDRESS);

            address_to_role.set(admin, MANAGER_ROLE);
        };
    }

    // Updates the address assigned to a given role.
    // Can only be called by the current role manager.
    fn update_role(public new_address: address, role: u16) -> Final {
        let caller: address = self.caller;
        return final {
            let current_role: u16 = address_to_role.get(caller);
            assert(current_role & MANAGER_ROLE == MANAGER_ROLE);

            if (caller == new_address) {
                assert(role & MANAGER_ROLE == MANAGER_ROLE);
            }

            address_to_role.set(new_address, role);
        };
    }

    // Updates the exchange rate for a given token.
    // Can only be called by the admin.
    fn update_rate(public token_id: field, public rate: u128) -> Final {
        let caller: address = self.caller;
        return final {
            let role: u16 = address_to_role.get(caller);
            assert(role & MANAGER_ROLE == MANAGER_ROLE);

            token_rates.set(token_id, rate);
        };
    }

    // Exchanges Aleo credits for private tokens at a specified rate.
    // Transfers credits to the treasury and mints private tokens to the caller.
    // The provided rate must match the stored rate for the token.
    fn exchange_token(public token_id: field, public amount: u64, public rate: u128) -> (token_registry.aleo::Token, Final) {
        let transfer_credits_call: Final = credits.aleo::transfer_public_as_signer(
            TREASURY_ADDRESS,
            amount
        );

        let token_amount: u128 = rate * amount as u128;
        let mint_token_call: (token_registry.aleo::Token, Final) = token_registry.aleo::mint_private(
            token_id,
            self.signer,
            token_amount,
            true,
            0u32
        );

        return (mint_token_call.0, final {
            let stored_rate: u128 = token_rates.get_or_use(token_id, DEFAULT_RATE);
            assert_eq(rate, stored_rate);

            transfer_credits_call.run();
            mint_token_call.1.run();
        });
    }

    // Exchanges Aleo credits for private timelock tokens at a specified rate.
    // Transfers credits to the treasury and mints both a CompliantToken and a timelock token to the caller.
    // The provided rate must match the stored rate for the timelock token.
    //
    // This function is separate from the standard token exchange because timelock tokens
    // require minting a CompliantToken record alongside the Token record.
    // Therefore, we must call this program directly instead of using token_registry.
    fn exchange_timelock_token(public amount: u64, public rate: u128) -> (sealed_timelock_policy.aleo::CompliantToken, token_registry.aleo::Token, Final) {
        let transfer_credits_call: Final = credits.aleo::transfer_public_as_signer(
            TREASURY_ADDRESS,
            amount
        );

        let token_amount: u128 = rate * amount as u128;
        let mint_token_call: (sealed_timelock_policy.aleo::CompliantToken, token_registry.aleo::Token, Final) = sealed_timelock_policy.aleo::mint_private(
            self.signer,
            token_amount,
            0u32
        );

        return (mint_token_call.0, mint_token_call.1, final {
            let stored_rate: u128 = token_rates.get_or_use(TIMELOCK_TOKEN_ID, DEFAULT_RATE);
            assert_eq(rate, stored_rate);

            transfer_credits_call.run();
            mint_token_call.2.run();
        });
    }
}
