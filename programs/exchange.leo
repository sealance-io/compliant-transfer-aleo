import credits.aleo;
import token_registry.aleo;
import compliant_timelock_transfer.aleo;

// The 'exchange' program.
program exchange.aleo {
    const TREASURY_ADDRESS: address = aleo1lwa86hr7qx99d7e3dcyv2s7wt9g8rmd6qxzm5zprad0c4ejynsqqvaxysn;
    const RATE: u128 = 10u128;

    async transition exchange_token(token_id: field, amount: u64) -> (token_registry.aleo/Token, Future) {
        let transfer_credits_call: Future = credits.aleo/transfer_public_as_signer(
            TREASURY_ADDRESS,
            amount as u64
        );

        let token_amount: u128 = RATE * amount as u128;
        let mint_token_call: (token_registry.aleo/Token, Future) = token_registry.aleo/mint_private(
            token_id,
            self.caller,
            token_amount, 
            true,
            0u32
        );

        return (mint_token_call.0, f_exchange_token(transfer_credits_call, mint_token_call.1));
    }

    async function f_exchange_token(transfer_call: Future, mint_call: Future) {
        transfer_call.await();
        mint_call.await();
    }

    async transition exchange_timelock_token(amount: u64) -> (compliant_timelock_transfer.aleo/CompliantToken, token_registry.aleo/Token, Future) {
        let transfer_credits_call: Future = credits.aleo/transfer_public_as_signer(
            TREASURY_ADDRESS,
            amount as u64
        );

        let token_amount: u128 = RATE * amount as u128;
        let mint_token_call: (compliant_timelock_transfer.aleo/CompliantToken, token_registry.aleo/Token, Future) = compliant_timelock_transfer.aleo/mint_private(
            self.caller,
            token_amount,
            0u32
        );

        return (mint_token_call.0, mint_token_call.1, f_exchange_timelock_token(transfer_credits_call, mint_token_call.2));
    }

    async function f_exchange_timelock_token(transfer_call: Future, mint_call: Future) {
        transfer_call.await();
        mint_call.await();
    }
}