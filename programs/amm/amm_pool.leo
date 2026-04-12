import multisig_core.aleo;
import lp_token.aleo;
import stable_token_1.aleo;
import stable_token_2.aleo;

struct ChecksumEdition {
    checksum: [u8; 32],
    edition: u16,
}

/// @dev Calculate invariant D for balances xp with amplification A, for n=2.
/// This matches the standard Curve StableSwap Newton iteration.
fn compute_invariant(token_balances: [u128; 2]) -> u128 {
    let total_balance: u128 = token_balances[0] + token_balances[1];
    if (total_balance == 0u128) {
        return 0u128;
    }
    let invariant: u128 = total_balance;
    for i: u8 in 0u8..MAX_ITERATIONS {
        let product_term: u128 = invariant * invariant / (token_balances[0] * 2 + 1); // +1 is to prevent /0
        product_term = product_term * invariant / (token_balances[1] * 2 + 1); // +1 is to prevent /0
        let previous_invariant: u128 = invariant;
        invariant = (ANN * total_balance + product_term * 2)
            * invariant
            / ((ANN - 1) * invariant + 3 * product_term + 1);
        if (absolute_difference(invariant, previous_invariant) <= 1) {
            return invariant;
        }
    }
    return invariant;
}

/// @dev Calculate for output pool balance y given the input reserve x and invariant D,
/// This matches the standard Curve StableSwap Newton iteration.
fn compute_output_token_balance(
    new_input_token_balance: u128,
    input_token_balance: u128,
    output_token_balance: u128,
) -> u128 {
    let token_balances: [u128; 2] = [input_token_balance, output_token_balance];
    let invariant = compute_invariant(token_balances);
    let product_term: u128 = invariant;
    product_term = product_term * invariant / (new_input_token_balance * 2);
    product_term = product_term * invariant / (ANN * 2);

    let sum_term: u128 = new_input_token_balance + invariant / ANN;

    let new_output_token_balance: u128 = invariant;
    for k in 0u8..MAX_ITERATIONS {
        let previous_estimate: u128 = new_output_token_balance;
        new_output_token_balance = (new_output_token_balance
            * new_output_token_balance
            + product_term)
            / (2 * new_output_token_balance + sum_term - invariant);
        if (absolute_difference(new_output_token_balance, previous_estimate) <= 1) {
            return new_output_token_balance;
        }
    }
    return new_output_token_balance;
}

fn absolute_difference(a: u128, b: u128) -> u128 {
    let diff: i128 = a as i128 - b as i128;
    let abs_diff: i128 = diff;
    if abs_diff < 0i128 {
        abs_diff = 0i128 - abs_diff;
    }
    return abs_diff as u128;
}

program amm_pool.aleo {
    @custom
    constructor() {
        // Only require multisig for upgrades - initial deployment has no checks.
        if self.edition > 0u16 {
            let signing_op_id = BHP256::hash_to_field(
                ChecksumEdition { checksum: self.checksum, edition: self.edition },
            );
            let wallet_signing_op_id_hash = BHP256::hash_to_field(
                multisig_core.aleo::WalletSigningOpId {
                    wallet_id: self.address,
                    signing_op_id: signing_op_id,
                },
            );
            let signing_complete = multisig_core.aleo::completed_signing_ops
                .contains(wallet_signing_op_id_hash);
            assert(signing_complete);
        }
    }

    const MAX_ITERATIONS: u8 = 9u8;
    const AMPLIFICATION: u128 = 85u128;
    const ANN: u128 = AMPLIFICATION * 2u128; // amplification * number of coins

    const FEE: u128 = 6_000_000u128; // 0.06% = 0.0006 * 1e10
    const ADMIN_FEE: u128 = 0u128; // 0%
    const FEE_DENOMINATOR: u128 = 10_000_000_000u128;

    const ADMIN_ADDRESS: address = aleo1mh7al4qsedqvsh64pmmlcmzl5ugmrdxp4a4rdneja7etn8cpuspqvrj9q8;

    record Stable_Token_1_Voucher {
        owner: address,
        voucher_id: field,
    }

    record Stable_Token_2_Voucher {
        owner: address,
        voucher_id: field,
    }

    record LP_Voucher {
        owner: address,
        voucher_id: field,
    }

    const INITIALIZED_INDEX: bool = true;
    mapping initialized: bool => bool;

    mapping vouchers: field => u128; // voucher_id => remaining amount
    storage stable_token_1_balance: u128; // Accounted balance used in AMM invariant (excludes reserved)
    storage stable_token_2_balance: u128; // Accounted balance used in AMM invariant (excludes reserved)

    storage stable_token_1_reserved: u128; // Amount reserved for unredeemed vouchers (not available for swaps)
    storage stable_token_2_reserved: u128; // Amount reserved for unredeemed vouchers (not available for swaps)
    storage lp_token_reserved: u128; // Amount reserved for unredeemed vouchers (not available for swaps)

    fn initialize() -> Final {
        let caller: address = self.caller;
        return final {
            assert_eq(ADMIN_ADDRESS, caller);

            let is_already_initialized: bool = initialized.get_or_use(INITIALIZED_INDEX, false);
            assert_eq(is_already_initialized, false);

            initialized.set(INITIALIZED_INDEX, true);

            stable_token_1_balance = 0u128;
            stable_token_2_balance = 0u128;
            stable_token_1_reserved = 0u128;
            stable_token_2_reserved = 0u128;
            lp_token_reserved = 0u128;
        };
    }

    fn add_liquidity(
        stable_token_1_amount: u128,
        stable_token_2_amount: u128,
        stable_token_1_record: stable_token_1.aleo::Token,
        stable_token_2_record: stable_token_2.aleo::Token,
        min_mint_amount: u128,
        stable_token_1_merkle_proof: [stable_token_1.aleo::MerkleProof; 2],
        stable_token_2_merkle_proof: [stable_token_2.aleo::MerkleProof; 2],
        voucher_id: field,
    ) -> (
        stable_token_1.aleo::Token, stable_token_2.aleo::Token, lp_token.aleo::Token, LP_Voucher,
        Final,
    ) {
        let transfer_stable_token_1: (
            stable_token_1.aleo::ComplianceRecord, stable_token_1.aleo::Token, Final,
        ) = stable_token_1.aleo::transfer_private_to_public(
            self.address,
            stable_token_1_amount,
            stable_token_1_record,
            stable_token_1_merkle_proof,
        );
        let transfer_stable_token_2: (
            stable_token_2.aleo::ComplianceRecord, stable_token_2.aleo::Token, Final,
        ) = stable_token_2.aleo::transfer_private_to_public(
            self.address,
            stable_token_2_amount,
            stable_token_2_record,
            stable_token_2_merkle_proof,
        );
        let mint_lp_token: (lp_token.aleo::ComplianceRecord, lp_token.aleo::Token, Final) = lp_token.aleo::mint_private(
            self.signer,
            min_mint_amount,
        );
        let lp_voucher_record = LP_Voucher { owner: self.signer, voucher_id: voucher_id };
        return (
            transfer_stable_token_1.1,
            transfer_stable_token_2.1,
            mint_lp_token.1,
            lp_voucher_record,
            final {
                // the total lp token should include the vouchers
                let token_info = lp_token.aleo::token_info.get(true);
                let token_supply = token_info.supply + lp_token_reserved.unwrap();
                let balances_before: [u128; 2] = [
                    stable_token_1_balance.unwrap(),
                    stable_token_2_balance.unwrap(),
                ];
                let invariant_before: u128 = token_supply > 0 ? compute_invariant(balances_before) : 0u128;
                let balances_after_deposit: [u128; 2] = [
                    balances_before[0] + stable_token_1_amount,
                    balances_before[1] + stable_token_2_amount,
                ];
                //Invariant after change
                let invariant_after_deposit: u128 = compute_invariant(balances_after_deposit);
                assert(invariant_after_deposit > invariant_before);

                // # Calculate, how much lp tokens to mint
                let voucher_exists = vouchers.contains(voucher_id);
                assert_eq(voucher_exists, false);
                if (token_supply == 0) {
                    assert_neq(stable_token_1_amount, 0u128);
                    assert_neq(stable_token_2_amount, 0u128);
                    stable_token_1_balance = balances_after_deposit[0];
                    stable_token_2_balance = balances_after_deposit[1];
                    let mint_amount: u128 = invariant_after_deposit;
                    // Validate the full LP mint amount against max_supply
                    assert(token_supply + mint_amount < token_info.max_supply);

                    let voucher_amount = mint_amount - min_mint_amount;
                    vouchers.set(voucher_id, voucher_amount);
                    lp_token_reserved = lp_token_reserved.unwrap() + voucher_amount;
                } else {
                    // We need to recalculate the invariant accounting for fees
                    // to calculate fair user's share
                    // Only account for fees if we are not the first to deposit
                    let fee_per_token: u128 = FEE / 2;
                    let ideal_balance: u128 = invariant_after_deposit
                        * balances_before[0]
                        / invariant_before;
                    let difference: u128 = absolute_difference(
                        ideal_balance,
                        balances_after_deposit[0],
                    );
                    let stable_token_1_fee: u128 = fee_per_token * difference / FEE_DENOMINATOR;
                    stable_token_1_balance = balances_after_deposit[0]
                        - stable_token_1_fee * ADMIN_FEE / FEE_DENOMINATOR;
                    ideal_balance = invariant_after_deposit * balances_before[1] / invariant_before;
                    difference = absolute_difference(ideal_balance, balances_after_deposit[1]);
                    let stable_token_2_fee: u128 = fee_per_token * difference / FEE_DENOMINATOR;
                    stable_token_2_balance = balances_after_deposit[1]
                        - stable_token_2_fee * ADMIN_FEE / FEE_DENOMINATOR;
                    let balances_after_fee: [u128; 2] = [
                        balances_after_deposit[0] - stable_token_1_fee,
                        balances_after_deposit[1] - stable_token_2_fee,
                    ];
                    let invariant_after_fee: u128 = compute_invariant(balances_after_fee);
                    let mint_amount: u128 = token_supply
                        * (invariant_after_fee - invariant_before)
                        / invariant_before;

                    // Validate the full LP mint amount against max_supply
                    assert(token_supply + mint_amount < token_info.max_supply);

                    let voucher_amount = mint_amount - min_mint_amount;
                    vouchers.set(voucher_id, voucher_amount);

                    lp_token_reserved = lp_token_reserved.unwrap() + voucher_amount;
                }
                transfer_stable_token_1.2.run();
                transfer_stable_token_2.2.run();
                mint_lp_token.2.run();
            },
        );
    }

    fn remove_liquidity(
        lp_token_amount: u128,
        min_stable_token_1_amount: u128,
        min_stable_token_2_amount: u128,
        lp_token_record: lp_token.aleo::Token,
        stable_token_1_voucher_id: field,
        stable_token_2_voucher_id: field,
    ) -> (
        lp_token.aleo::Token, stable_token_1.aleo::Token, stable_token_2.aleo::Token,
        Stable_Token_1_Voucher, Stable_Token_2_Voucher, Final,
    ) {
        let burn_lp_token: (lp_token.aleo::ComplianceRecord, lp_token.aleo::Token, Final) = lp_token.aleo::burn_private(
            lp_token_record,
            lp_token_amount,
        );
        let transfer_stable_token_1: (
            stable_token_1.aleo::ComplianceRecord, stable_token_1.aleo::Token, Final,
        ) = stable_token_1.aleo::transfer_public_to_private(
            lp_token_record.owner,
            min_stable_token_1_amount,
        );
        let transfer_stable_token_2: (
            stable_token_2.aleo::ComplianceRecord, stable_token_2.aleo::Token, Final,
        ) = stable_token_2.aleo::transfer_public_to_private(
            lp_token_record.owner,
            min_stable_token_2_amount,
        );
        let stable_coin_1_voucher = Stable_Token_1_Voucher {
            owner: lp_token_record.owner,
            voucher_id: stable_token_1_voucher_id,
        };
        let stable_coin_2_voucher = Stable_Token_2_Voucher {
            owner: lp_token_record.owner,
            voucher_id: stable_token_2_voucher_id,
        };
        return (
            burn_lp_token.1, transfer_stable_token_1.1, transfer_stable_token_2.1,
            stable_coin_1_voucher, stable_coin_2_voucher,
            final {
                let token_info = lp_token.aleo::token_info.get(true);
                let token_supply = token_info.supply + lp_token_reserved.unwrap();
                let amount_token_1: u128 = stable_token_1_balance.unwrap()
                    * lp_token_amount
                    / token_supply;
                stable_token_1_balance = stable_token_1_balance.unwrap() - amount_token_1;
                let voucher_1_exists = vouchers.contains(stable_token_1_voucher_id);
                assert_eq(voucher_1_exists, false);
                let stable_token_1_voucher_amount = amount_token_1 - min_stable_token_1_amount;
                vouchers.set(stable_token_1_voucher_id, stable_token_1_voucher_amount);
                stable_token_1_reserved = stable_token_1_reserved.unwrap()
                    + stable_token_1_voucher_amount;

                let amount_token_2: u128 = stable_token_2_balance.unwrap()
                    * lp_token_amount
                    / token_supply;
                stable_token_2_balance = stable_token_2_balance.unwrap() - amount_token_2;
                let voucher_2_exists = vouchers.contains(stable_token_2_voucher_id);
                assert_eq(voucher_2_exists, false);
                let stable_token_2_voucher_amount = amount_token_2 - min_stable_token_2_amount;
                vouchers.set(stable_token_2_voucher_id, stable_token_2_voucher_amount);
                stable_token_2_reserved = stable_token_2_reserved.unwrap()
                    + stable_token_2_voucher_amount;

                burn_lp_token.2.run();
                transfer_stable_token_1.2.run();
                transfer_stable_token_2.2.run();
            },
        );
    }

    fn exchange_1_for_2(
        input_amount: u128,
        min_output_amount: u128,
        input_record: stable_token_1.aleo::Token,
        merkle_proof: [stable_token_1.aleo::MerkleProof; 2],
        voucher_id: field,
    ) -> (stable_token_1.aleo::Token, stable_token_2.aleo::Token, Stable_Token_2_Voucher, Final) {
        let transfer_input_token: (
            stable_token_1.aleo::ComplianceRecord, stable_token_1.aleo::Token, Final,
        ) = stable_token_1.aleo::transfer_private_to_public(
            self.address,
            input_amount,
            input_record,
            merkle_proof,
        );
        let transfer_output_token: (
            stable_token_2.aleo::ComplianceRecord, stable_token_2.aleo::Token, Final,
        ) = stable_token_2.aleo::transfer_public_to_private(input_record.owner, min_output_amount);
        let voucher = Stable_Token_2_Voucher { owner: input_record.owner, voucher_id: voucher_id };
        return (
            transfer_input_token.1, // input token record leftover
            transfer_output_token.1, // output token record
            voucher,
            final {
                let input_token_balance = stable_token_1_balance.unwrap();
                let output_token_balance = stable_token_2_balance.unwrap();
                let new_input_token_balance: u128 = input_token_balance + input_amount;
                let new_output_token_balance: u128 = compute_output_token_balance(
                    new_input_token_balance,
                    input_token_balance,
                    output_token_balance,
                );
                let gross_output_amount: u128 = output_token_balance - new_output_token_balance;

                let fee_amount: u128 = gross_output_amount * FEE / FEE_DENOMINATOR;
                let admin_fee_amount: u128 = fee_amount * ADMIN_FEE / FEE_DENOMINATOR;

                stable_token_1_balance = new_input_token_balance;
                stable_token_2_balance = new_output_token_balance + (fee_amount - admin_fee_amount);

                let net_output_amount: u128 = gross_output_amount - fee_amount;

                let voucher_exists = vouchers.contains(voucher_id);
                assert_eq(voucher_exists, false);
                let voucher_amount = net_output_amount - min_output_amount;
                vouchers.set(voucher_id, voucher_amount);
                stable_token_2_reserved = stable_token_2_reserved.unwrap() + voucher_amount;

                transfer_input_token.2.run();
                transfer_output_token.2.run();
            },
        );
    }

    fn exchange_2_for_1(
        input_amount: u128,
        min_output_amount: u128,
        input_record: stable_token_2.aleo::Token,
        merkle_proof: [stable_token_2.aleo::MerkleProof; 2],
        voucher_id: field,
    ) -> (stable_token_2.aleo::Token, stable_token_1.aleo::Token, Stable_Token_1_Voucher, Final) {
        let transfer_input_token: (
            stable_token_2.aleo::ComplianceRecord, stable_token_2.aleo::Token, Final,
        ) = stable_token_2.aleo::transfer_private_to_public(
            self.address,
            input_amount,
            input_record,
            merkle_proof,
        );
        let transfer_output_token: (
            stable_token_1.aleo::ComplianceRecord, stable_token_1.aleo::Token, Final,
        ) = stable_token_1.aleo::transfer_public_to_private(input_record.owner, min_output_amount);
        let voucher = Stable_Token_1_Voucher { owner: input_record.owner, voucher_id: voucher_id };
        return (
            transfer_input_token.1, // input token record leftover
            transfer_output_token.1, // output token record
            voucher,
            final {
                let input_token_balance = stable_token_2_balance.unwrap();
                let output_token_balance = stable_token_1_balance.unwrap();
                let new_input_token_balance: u128 = input_token_balance + input_amount;
                let new_output_token_balance: u128 = compute_output_token_balance(
                    new_input_token_balance,
                    input_token_balance,
                    output_token_balance,
                );
                let gross_output_amount: u128 = output_token_balance - new_output_token_balance;

                let fee_amount: u128 = gross_output_amount * FEE / FEE_DENOMINATOR;
                let admin_fee_amount: u128 = fee_amount * ADMIN_FEE / FEE_DENOMINATOR;

                stable_token_2_balance = new_input_token_balance;
                stable_token_1_balance = new_output_token_balance + (fee_amount - admin_fee_amount);

                let net_output_amount: u128 = gross_output_amount - fee_amount;

                let voucher_exists = vouchers.contains(voucher_id);
                assert_eq(voucher_exists, false);
                let voucher_amount = net_output_amount - min_output_amount;
                vouchers.set(voucher_id, voucher_amount);
                stable_token_1_reserved = stable_token_1_reserved.unwrap() + voucher_amount;

                transfer_input_token.2.run();
                transfer_output_token.2.run();
            },
        );
    }

    fn redeem_stable_token_1_voucher(
        voucher: Stable_Token_1_Voucher,
        amount: u128,
    ) -> (stable_token_1.aleo::Token, Stable_Token_1_Voucher, Final) {
        let transfer_call: (
            stable_token_1.aleo::ComplianceRecord, stable_token_1.aleo::Token, Final,
        ) = stable_token_1.aleo::transfer_public_to_private(voucher.owner, amount);
        let new_voucher = Stable_Token_1_Voucher {
            owner: voucher.owner,
            voucher_id: voucher.voucher_id,
        };
        let voucher_id = voucher.voucher_id;
        return (
            transfer_call.1, new_voucher,
            final {
                let voucher_amount = vouchers.get(voucher_id);
                vouchers.set(voucher_id, voucher_amount - amount);
                stable_token_1_reserved = stable_token_1_reserved.unwrap() - amount;

                transfer_call.2.run();
            },
        );
    }

    fn redeem_stable_token_2_voucher(
        voucher: Stable_Token_2_Voucher,
        amount: u128,
    ) -> (stable_token_2.aleo::Token, Stable_Token_2_Voucher, Final) {
        let transfer_call: (
            stable_token_2.aleo::ComplianceRecord, stable_token_2.aleo::Token, Final,
        ) = stable_token_2.aleo::transfer_public_to_private(voucher.owner, amount);
        let new_voucher = Stable_Token_2_Voucher {
            owner: voucher.owner,
            voucher_id: voucher.voucher_id,
        };
        let voucher_id = voucher.voucher_id;
        return (
            transfer_call.1, new_voucher,
            final {
                let voucher_amount = vouchers.get(voucher_id);
                vouchers.set(voucher_id, voucher_amount - amount);
                stable_token_2_reserved = stable_token_2_reserved.unwrap() - amount;

                transfer_call.2.run();
            },
        );
    }

    fn redeem_lp_token_voucher(
        voucher: LP_Voucher,
        amount: u128,
    ) -> (lp_token.aleo::Token, LP_Voucher, Final) {
        let mint_call: (lp_token.aleo::ComplianceRecord, lp_token.aleo::Token, Final) = lp_token.aleo::mint_private(
            voucher.owner,
            amount,
        );
        let new_voucher = LP_Voucher { owner: voucher.owner, voucher_id: voucher.voucher_id };
        let voucher_id = voucher.voucher_id;
        return (
            mint_call.1, new_voucher,
            final {
                let voucher_amount = vouchers.get(voucher_id);
                vouchers.set(voucher_id, voucher_amount - amount);
                lp_token_reserved = lp_token_reserved.unwrap() - amount;

                mint_call.2.run();
            },
        );
    }

    fn withdraw_admin_fees(stable_token_1_amount: u128, stable_token_2_amount: u128) -> Final {
        let transfer_stable_token_1: Final = stable_token_1.aleo::transfer_public(
            ADMIN_ADDRESS,
            stable_token_1_amount,
        );
        let transfer_stable_token_2: Final = stable_token_2.aleo::transfer_public(
            ADMIN_ADDRESS,
            stable_token_2_amount,
        );
        let caller: address = self.caller;
        return final {
            assert_eq(ADMIN_ADDRESS, caller);
            let stable_token_1_pool_balance = stable_token_1.aleo::balances.get(self.address);
            assert(stable_token_1_pool_balance
                - (stable_token_1_balance.unwrap() + stable_token_1_reserved.unwrap())
                >= stable_token_1_amount);
            let stable_token_2_pool_balance = stable_token_2.aleo::balances.get(self.address);
            assert(stable_token_2_pool_balance
                - (stable_token_2_balance.unwrap() + stable_token_2_reserved.unwrap())
                >= stable_token_2_amount);
            transfer_stable_token_1.run();
            transfer_stable_token_2.run();
        };
    }
}
