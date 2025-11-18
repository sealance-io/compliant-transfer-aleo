// The 'multisig_impl' program.
//
// This contains the inner implementation of an k-of-n multisig scheme.
// It is meant to only be used by the multisig.aleo program.

program multisig_impl.aleo {
    const ZERO_ADDRESS: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;

    //@noupgrade
    @admin(address="aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px")
    async constructor() {
    }

    ///////////////////////////////////////////////////////////////////////////
    // Wallet settings
    ///////////////////////////////////////////////////////////////////////////

    struct Wallet {
        // The program that owns the wallet. This will almost always be multisig.aleo,
        // but is provided here in case we want to have other programs own wallets in the future.
        wallet_owner: address,

        // Unique wallet identifier provided by the wallet creator.
        wallet_id: address,
    }

    struct WalletUser {
        wallet: Wallet,
        user: address,
    }

    struct WalletSettings {
        threshold: u8,
        num_signers: u8,
    }

    mapping signers_map: field => bool; // hash(WalletUser) => true/false (whether this user is an signer or not)
    mapping wallets_map: field => WalletSettings; // hash(Wallet) => settings

    ///////////////////////////////////////////////////////////////////////////
    // Signing operations
    ///////////////////////////////////////////////////////////////////////////

    // A unique identifier for a signing operation that is "namespaced" to a specific wallet
    struct WalletSigningOpId {
        wallet: Wallet,
        signing_op_id: field,
    }

    // Data stored for a signing operation
    struct WalletSigningOp {
        wallet: Wallet,
        confirmations: u8,
    }

    // A confirmation that a specific signing operation (identified by a hash of
    // WalletSigningOpId) has been signed by a specific user (identified by a hash of WalletUser)
    struct SigningOpConfirmation {
        wallet_signing_op_id_hash: field,
        wallet_user_hash: field,
    }

    mapping pending_signing_ops: field => WalletSigningOp; // hash(WalletSigningOpId) => WalletSigningOp
    mapping pending_signing_confirmations: field => bool; // hash(SigningOpConfirmation) => true/false (whether this user signed)

    mapping completed_signing_ops: field => bool; // hash(WalletSigningOpId) => true/none (true once signatures exceeded threshold)

    ///////////////////////////////////////////////////////////////////////////

    ///////////////////////////////////////////////////////////////////////////
    // Create a new multisig wallet
    ///////////////////////////////////////////////////////////////////////////

    async transition create_wallet(wallet_id: address, threshold: u8, signers: [address; 4]) -> Future {
        assert(threshold > 0u8 && threshold <= 4u8);

        let wallet = Wallet {
            wallet_owner: self.caller,
            wallet_id: wallet_id,
        };
        let user_hashes: [field; 4] = [
            BHP256::hash_to_field(WalletUser { wallet: wallet, user: signers[0] }),
            BHP256::hash_to_field(WalletUser { wallet: wallet, user: signers[1] }),
            BHP256::hash_to_field(WalletUser { wallet: wallet, user: signers[2] }),
            BHP256::hash_to_field(WalletUser { wallet: wallet, user: signers[3] }),
        ];


        return finalize_create_wallet(
            wallet,
            threshold,
            user_hashes,
        );
    }

    async function finalize_create_wallet(
        wallet: Wallet,
        threshold: u8,
        user_hashes: [field; 4],
    ) {
        // Ensure the wallet does not already exist.
        let wallet_hash = BHP256::hash_to_field(wallet);
        assert(!wallets_map.contains(wallet_hash));

        // Store signers + validate signers are unique
        let zero_addr_hash = BHP256::hash_to_field(WalletUser { wallet: wallet, user: ZERO_ADDRESS });

        let num_users: u8 = 0;

        for i: u8 in 0..4 {
            if (user_hashes[i] != zero_addr_hash) {
                assert(!signers_map.contains(user_hashes[i]));
                signers_map.set(user_hashes[i], true);
            }
            num_users += (user_hashes[i] != zero_addr_hash) ? 1 : 0;
        }

        assert(num_users >= threshold);

        // Create wallet by storing its settings.
        wallets_map.set(wallet_hash, WalletSettings { threshold: threshold, num_signers: num_users });
    }


    ///////////////////////////////////////////////////////////////////////////
    // Begin a signing operation
    ///////////////////////////////////////////////////////////////////////////
    async transition initiate_signing_op(wallet_id: address, signing_op_id: field) -> (field, Future) {
        let wallet = Wallet { wallet_owner: self.caller, wallet_id: wallet_id };
        let signer = WalletUser { wallet: wallet, user: self.signer };
        let signer_hash = BHP256::hash_to_field(signer);

        let wallet_signing_op_id_hash = BHP256::hash_to_field(WalletSigningOpId { wallet: wallet, signing_op_id: signing_op_id });

         return (wallet_signing_op_id_hash, finalize_initiate_signing_op(wallet, wallet_signing_op_id_hash, signer_hash));
    }

    async function finalize_initiate_signing_op(wallet: Wallet, wallet_signing_op_id_hash: field, signer_hash: field) {
        // Signer must be an signer to initiate.
        // TODO could remove this requirement and just not create a confirmation if someone else initiated a signing.
        // If removing, make sure to remove the code at the bottom that marks completion!
        assert(signers_map.contains(signer_hash) && signers_map.get(signer_hash));

        // Signing op should not have been used before.
        assert(!pending_signing_ops.contains(wallet_signing_op_id_hash));

        // Store the new pending signing op
        pending_signing_ops.set(wallet_signing_op_id_hash, WalletSigningOp {
            wallet: wallet,
            confirmations: 1,
        });

        let confirmation_hash =  BHP256::hash_to_field(SigningOpConfirmation {
            wallet_signing_op_id_hash: wallet_signing_op_id_hash,
            wallet_user_hash: signer_hash,
        });
        assert(!pending_signing_confirmations.contains(confirmation_hash));
        pending_signing_confirmations.set(confirmation_hash, true);

        // Mark complete if possible
        let wallet_hash = BHP256::hash_to_field(wallet);
        let wallet_settings = wallets_map.get(wallet_hash);
        if 1 >= wallet_settings.threshold {
            completed_signing_ops.set(wallet_signing_op_id_hash, true);
            // NOTE: We never remove from pending_signing_ops to ensure signing_op_id is always unique
        }
    }

    ///////////////////////////////////////////////////////////////////////////
    // Provide a signature to a signing operation
    ///////////////////////////////////////////////////////////////////////////

    async transition sign(wallet_id: address, signing_op_id: field) -> Future {
        let wallet = Wallet { wallet_owner: self.caller, wallet_id: wallet_id };
        let signer = WalletUser { wallet: wallet, user: self.signer };
        let signer_hash = BHP256::hash_to_field(signer);

        return finalize_sign(wallet, signing_op_id, signer_hash);
    }

    async function finalize_sign(wallet: Wallet, signing_op_id: field, signer_hash: field) {
        // Signer must be an signer to sign.
       assert(signers_map.contains(signer_hash) && signers_map.get(signer_hash));

        // Signing op must exist.
        let wallet_signing_op_id_hash = BHP256::hash_to_field(WalletSigningOpId { wallet: wallet, signing_op_id: signing_op_id });
        assert(pending_signing_ops.contains(wallet_signing_op_id_hash));
        let signing_op = pending_signing_ops.get(wallet_signing_op_id_hash);


        let confirmation_hash =  BHP256::hash_to_field(SigningOpConfirmation {
            wallet_signing_op_id_hash: wallet_signing_op_id_hash,
            wallet_user_hash: signer_hash,
        });
        assert(!pending_signing_confirmations.contains(confirmation_hash)); // The signer cant sign twice
        pending_signing_confirmations.set(confirmation_hash, true);


        // Increase confirmations
        let new_signing_op = WalletSigningOp {
            wallet: wallet,
            confirmations: signing_op.confirmations + 1,
        };
        pending_signing_ops.set(wallet_signing_op_id_hash, new_signing_op);
        pending_signing_confirmations.set(confirmation_hash, true);

        // Mark completed if possible
        let wallet_hash = BHP256::hash_to_field(wallet);
        let wallet_settings = wallets_map.get(wallet_hash);
        // NOTE: We check the number of confirmations against the *current* threshold,
        // not the threshold that was set when signing was initiated.
        // While storing the threshold upon initiation is trivial, capturing a snapshot of the signer
        // set is difficult, so we just use the current settings.
        if new_signing_op.confirmations >= wallet_settings.threshold {
            completed_signing_ops.set(wallet_signing_op_id_hash, true);
        }

        // NOTE: We never remove from pending_signing_ops to ensure signing_op_id is always unique
    }

    ///////////////////////////////////////////////////////////////////////////
    // Admin operations
    ///////////////////////////////////////////////////////////////////////////

    const ADMIN_OP_CHANGE_THRESHOLD: u8 = 1;
    const ADMIN_OP_ADD_SIGNER: u8 = 2;
    const ADMIN_OP_REMOVE_SIGNER: u8 = 3;

    // An administrative operation that hashed sensitive details (the user address)
    struct HashedAdminOp {
        op: u8,

        // Only used for ADMIN_OP_CHANGE_THRESHOLD
        threshold: u8,

        // Only used for ADMIN_OP_ADD_SIGNER and ADMIN_OP_REMOVE_SIGNER
        wallet_user_hash: field,
    }

    function assert_valid_admin_op(admin_op: HashedAdminOp) {
        if (admin_op.op == ADMIN_OP_CHANGE_THRESHOLD) {
            assert_neq(admin_op.threshold, 0u8);
            assert_eq(admin_op.wallet_user_hash, 0field);
        } else if (admin_op.op == ADMIN_OP_ADD_SIGNER || admin_op.op == ADMIN_OP_REMOVE_SIGNER) {
            assert_eq(admin_op.threshold, 0u8);
            assert_neq(admin_op.wallet_user_hash, 0field);
        } else {
            assert(false);
        }
    }

    async transition exec_admin_op(wallet_id: address, admin_op: HashedAdminOp) -> Future {
        assert_valid_admin_op(admin_op);

        let wallet = Wallet { wallet_owner: self.caller, wallet_id: wallet_id };
        return fin_exec_admin_op(wallet, admin_op);
    }

    async function fin_exec_admin_op(wallet: Wallet, admin_op: HashedAdminOp) {
        // Ensure wallet exists
        let wallet_hash = BHP256::hash_to_field(wallet);
        let wallet_settings = wallets_map.get(wallet_hash);

        if (admin_op.op == ADMIN_OP_CHANGE_THRESHOLD) {
            assert(admin_op.threshold <= wallet_settings.num_signers);
            wallets_map.set(wallet_hash, WalletSettings {
                threshold: admin_op.threshold,
                num_signers: wallet_settings.num_signers,
            });
        } else if (admin_op.op == ADMIN_OP_ADD_SIGNER) {
            assert(!signers_map.contains(admin_op.wallet_user_hash));
            signers_map.set(admin_op.wallet_user_hash, true);

            wallets_map.set(wallet_hash, WalletSettings {
                threshold: wallet_settings.threshold,
                num_signers: wallet_settings.num_signers + 1
            });
        } else if (admin_op.op == ADMIN_OP_REMOVE_SIGNER) {
            assert(signers_map.contains(admin_op.wallet_user_hash));
            signers_map.remove(admin_op.wallet_user_hash);

            assert(wallet_settings.num_signers - 1 >= wallet_settings.threshold);

            wallets_map.set(wallet_hash, WalletSettings {
                threshold: wallet_settings.threshold,
                num_signers: wallet_settings.num_signers - 1
            });
         } else {
            assert(false);
        }
    }

    ///////////////////////////////////////////////////////////////////////////
    // Helpers
    ///////////////////////////////////////////////////////////////////////////

    async transition assert_signing_completed(wallet_id: address, signing_op_id: field) -> Future {
        let wallet = Wallet { wallet_owner: self.caller, wallet_id: wallet_id };
        let fut = fin_assert_signing_completed(wallet, signing_op_id);
        return fut;
    }

    async function fin_assert_signing_completed(wallet: Wallet, signing_op_id: field) {
        let wallet_signing_op_id_hash = BHP256::hash_to_field(WalletSigningOpId { wallet: wallet, signing_op_id: signing_op_id });
        let signing_complete = completed_signing_ops.contains(wallet_signing_op_id_hash);
        assert(signing_complete);
    }
}