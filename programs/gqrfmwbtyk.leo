import credits.aleo;
import token_registry.aleo;
import rawxtbrzce.aleo;

// The 'exchange' program.
// This is a simple exchange program to demonstrate the complaint tokens capabilities. It is intended only for Aleo testnet
program gqrfmwbtyk.aleo {
    
    const TREASURY_ADDRESS: address = aleo1lwa86hr7qx99d7e3dcyv2s7wt9g8rmd6qxzm5zprad0c4ejynsqqvaxysn;
    const DEFAULT_RATE: u128 = 10u128;

    mapping token_rates: field => u128;     
    mapping admin: u8 => address;

    async transition update_admin(public new_admin: address) -> Future {
        return f_update_admin(self.caller, new_admin);
    }

    async function f_update_admin(caller: address, new_admin: address) {
        let current_admin: address = admin.get_or_use(0u8, caller);
        assert_eq(current_admin, caller);

        admin.set(0u8, new_admin);
    }

    async transition update_rate(public token_id: field, public rate: u128) -> Future {
        return f_update_rate(self.caller, token_id, rate);
    }

    async function f_update_rate(caller: address, token_id: field, rate: u128) {
        let current_admin: address = admin.get(0u8);
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
            self.caller,
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

    async transition exchange_timelock_token(public amount: u64, public rate: u128) -> (rawxtbrzce.aleo/CompliantToken, token_registry.aleo/Token, Future) {
        let transfer_credits_call: Future = credits.aleo/transfer_public_as_signer(
            TREASURY_ADDRESS,
            amount
        );

        let token_amount: u128 = rate * amount as u128;
        let mint_token_call: (rawxtbrzce.aleo/CompliantToken, token_registry.aleo/Token, Future) = rawxtbrzce.aleo/mint_private(
            self.caller,
            token_amount,
            0u32
        );

        return (mint_token_call.0, mint_token_call.1, f_exchange_timelock_token(121700012454193788241350538767360056604864872662350field, rate, transfer_credits_call, mint_token_call.2));
    }

    async function f_exchange_timelock_token(token_id: field, rate: u128,transfer_call: Future, mint_call: Future) {
        let stored_rate: u128 = token_rates.get_or_use(token_id, DEFAULT_RATE);
        assert_eq(rate, stored_rate);

        transfer_call.await();
        mint_call.await();
    }
}