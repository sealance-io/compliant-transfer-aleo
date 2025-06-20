import credits.aleo;
import token_registry.aleo;
import sealed_timelock_policy.aleo;

// The 'exchange' program.
// This is a simple exchange program to demonstrate the complaint tokens capabilities. It is intended only for Aleo testnet
program gqrfmwbtyp.aleo {

    const TREASURY_ADDRESS: address = aleo1lwa86hr7qx99d7e3dcyv2s7wt9g8rmd6qxzm5zprad0c4ejynsqqvaxysn;
    const DEFAULT_RATE: u128 = 10u128;
    const TIMELOCK_TOKEN_ID: field = 31155203188273609789785737924444174490841009372087129field;

    const ADMIN_INDEX: u8 = 1u8;

    mapping token_rates: field => u128;     
    mapping roles: u8 => address;

    async transition update_role(public new_address: address, role: u8) -> Future {
        return f_update_role(new_address, self.caller, role);
    }
    async function f_update_role(new_address: address, caller: address, role: u8) {
        let admin_address: address = roles.get_or_use(ADMIN_INDEX, caller);
        assert_eq(admin_address, caller);
        roles.set(role, new_address);
    }

    async transition update_rate(public token_id: field, public rate: u128) -> Future {
        return f_update_rate(self.caller, token_id, rate);
    }

    async function f_update_rate(caller: address, token_id: field, rate: u128) {
        let current_admin: address = roles.get(ADMIN_INDEX);
        assert_eq(caller, current_admin);

        token_rates.set(token_id, rate);
    }

    async transition exchange_token(public token_id: field, public amount: u64, public rate: u128) -> (token_registry.aleo/Token, Future) {
        let transfer_credits_call: Future = credits.aleo/transfer_public_as_signer(
            TREASURY_ADDRESS,
            amount
        );

        let token_amount: u128 = rate * amount as u128;
        let mint_token_call: (token_registry.aleo/Token, Future) = token_registry.aleo/mint_private(
            token_id,
            self.signer,
            token_amount, 
            true,
            0u32
        );

        return (mint_token_call.0, f_exchange_token(token_id, rate, transfer_credits_call, mint_token_call.1));
    }

    async function f_exchange_token(token_id: field, rate: u128, transfer_call: Future, mint_call: Future) {
        let stored_rate: u128 = token_rates.get_or_use(token_id, DEFAULT_RATE);
        assert_eq(rate, stored_rate);

        transfer_call.await();
        mint_call.await();
    }

    async transition exchange_timelock_token(public amount: u64, public rate: u128) -> (sealed_timelock_policy.aleo/CompliantToken, token_registry.aleo/Token, Future) {
        let transfer_credits_call: Future = credits.aleo/transfer_public_as_signer(
            TREASURY_ADDRESS,
            amount
        );

        let token_amount: u128 = rate * amount as u128;
        let mint_token_call: (sealed_timelock_policy.aleo/CompliantToken, token_registry.aleo/Token, Future) = sealed_timelock_policy.aleo/mint_private(
            self.signer,
            token_amount,
            0u32
        );

        return (mint_token_call.0, mint_token_call.1, f_exchange_timelock_token(rate, transfer_credits_call, mint_token_call.2));
    }

    async function f_exchange_timelock_token(rate: u128, transfer_call: Future, mint_call: Future) {
        let stored_rate: u128 = token_rates.get_or_use(TIMELOCK_TOKEN_ID, DEFAULT_RATE);
        assert_eq(rate, stored_rate);

        transfer_call.await();
        mint_call.await();
    }
}