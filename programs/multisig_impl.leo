// The 'multisig_impl' program.
//
// This contains the inner implementation of an k-of-n multisig scheme.
// It is meant to only be used by the multisig.aleo program.

program multisig_impl.aleo {
    const ALEO_ZERO_ADDRESS: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;
    const ETH_ZERO_ADDRESS: [u8; 20] = [0u8; 20];

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

    struct WalletAleoSigner {
        wallet: Wallet,
        user: address,
    }

    struct WalletEcdsaSigner {
        wallet: Wallet,
        ecdsa_signer: [u8; 20],
    }

    struct WalletSettings {
        threshold: u8,
        num_signers: u8,
    }

    // Note that we do not distinguish between Aleo and ECDSA signers here since we're just storing hashes of their addresses
    // (together with the Wallet information).
    // Since Aleo addresses and Eth addresses are of a different size, collisions are impossible.
    mapping signers_map: field => bool; // hash(WalletAleoSigner or WalletEcdsaSigner) => true/false (whether this user is an signer or not)
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
    // WalletSigningOpId) has been signed by a specific user (identified by a hash of WalletAleoSigner/WalletEcdsaSigner)
    struct SigningOpConfirmation {
        wallet_signing_op_id_hash: field,
        wallet_signer_hash: field,
    }

    mapping pending_signing_ops: field => WalletSigningOp; // hash(WalletSigningOpId) => WalletSigningOp
    mapping pending_signing_confirmations: field => bool; // hash(SigningOpConfirmation) => true/false (whether this user signed)

    mapping completed_signing_ops: field => bool; // hash(WalletSigningOpId) => true/none (true once signatures exceeded threshold)

    ///////////////////////////////////////////////////////////////////////////

    ///////////////////////////////////////////////////////////////////////////
    // Create a new multisig wallet
    ///////////////////////////////////////////////////////////////////////////

    async transition create_wallet(
        public wallet_id: address,
        public threshold: u8,
        aleo_signers: [address; 4],
        ecdsa_signers: [[u8; 20]; 4],
    ) -> Future {
        // Note: This is further tested in the finalize method
        assert(threshold > 0u8 && threshold <= 8u8);

        let wallet = Wallet {
            wallet_owner: self.caller,
            wallet_id: wallet_id,
        };
        let aleo_signer_hashes: [field; 4] = [
            BHP256::hash_to_field(WalletAleoSigner { wallet: wallet, user: aleo_signers[0] }),
            BHP256::hash_to_field(WalletAleoSigner { wallet: wallet, user: aleo_signers[1] }),
            BHP256::hash_to_field(WalletAleoSigner { wallet: wallet, user: aleo_signers[2] }),
            BHP256::hash_to_field(WalletAleoSigner { wallet: wallet, user: aleo_signers[3] }),
        ];
        let ecdsa_signer_hashes: [field; 4] = [
            BHP256::hash_to_field(WalletEcdsaSigner { wallet: wallet, ecdsa_signer: ecdsa_signers[0] }),
            BHP256::hash_to_field(WalletEcdsaSigner { wallet: wallet, ecdsa_signer: ecdsa_signers[1] }),
            BHP256::hash_to_field(WalletEcdsaSigner { wallet: wallet, ecdsa_signer: ecdsa_signers[2] }),
            BHP256::hash_to_field(WalletEcdsaSigner { wallet: wallet, ecdsa_signer: ecdsa_signers[3] }),
        ];

        return finalize_create_wallet(
            wallet,
            threshold,
            aleo_signer_hashes,
            ecdsa_signer_hashes,
        );
    }

    async function finalize_create_wallet(
        wallet: Wallet,
        threshold: u8,
        aleo_signer_hashes: [field; 4],
        ecdsa_signer_hashes: [field; 4],
    ) {
        // Ensure the wallet does not already exist.
        let wallet_hash = BHP256::hash_to_field(wallet);
        assert(!wallets_map.contains(wallet_hash));

        // Store signers + validate signers are unique
        let aleo_zero_addr_hash = BHP256::hash_to_field(WalletAleoSigner { wallet: wallet, user: ALEO_ZERO_ADDRESS });
        let ecdsa_zero_addr_hash = BHP256::hash_to_field(WalletEcdsaSigner { wallet: wallet, ecdsa_signer: ETH_ZERO_ADDRESS });

        let num_users: u8 = 0;

        for i: u8 in 0..4 {
            if (aleo_signer_hashes[i] != aleo_zero_addr_hash) {
                assert(!signers_map.contains(aleo_signer_hashes[i]));
                signers_map.set(aleo_signer_hashes[i], true);
            }
            num_users += (aleo_signer_hashes[i] != aleo_zero_addr_hash) ? 1 : 0;

            if (ecdsa_signer_hashes[i] != ecdsa_zero_addr_hash) {
                assert(!signers_map.contains(ecdsa_signer_hashes[i]));
                signers_map.set(ecdsa_signer_hashes[i], true);
            }
            num_users += (ecdsa_signer_hashes[i] != ecdsa_zero_addr_hash) ? 1 : 0;
        }

        assert(num_users >= threshold);

        // Create wallet by storing its settings.
        wallets_map.set(wallet_hash, WalletSettings { threshold: threshold, num_signers: num_users });
    }


    ///////////////////////////////////////////////////////////////////////////
    // Begin a signing operation
    ///////////////////////////////////////////////////////////////////////////

    async transition initiate_signing_op(public wallet_id: address, public signing_op_id: field) -> (field, Future) {
        let wallet = Wallet { wallet_owner: self.caller, wallet_id: wallet_id };
        let wallet_signing_op_id_hash = BHP256::hash_to_field(WalletSigningOpId { wallet: wallet, signing_op_id: signing_op_id });

        let signer = WalletAleoSigner { wallet: wallet, user: self.signer };
        let signer_hash = BHP256::hash_to_field(signer);

         return (wallet_signing_op_id_hash, finalize_initiate_signing_op(wallet, wallet_signing_op_id_hash, signer_hash));
    }

    async function finalize_initiate_signing_op(wallet: Wallet, wallet_signing_op_id_hash: field, aleo_signer_hash: field) {
        // Signing op should not have been used before.
        assert(!pending_signing_ops.contains(wallet_signing_op_id_hash));

        // If signer is known then record it
        if (signers_map.contains(aleo_signer_hash)) {
            // Store the new pending signing op
            pending_signing_ops.set(wallet_signing_op_id_hash, WalletSigningOp {
                wallet: wallet,
                confirmations: 1,
            });

            let confirmation_hash =  BHP256::hash_to_field(SigningOpConfirmation {
                wallet_signing_op_id_hash: wallet_signing_op_id_hash,
                wallet_signer_hash: aleo_signer_hash,
            });
            assert(!pending_signing_confirmations.contains(confirmation_hash));
            pending_signing_confirmations.set(confirmation_hash, true);

            // Mark complete if possible
            let wallet_hash = BHP256::hash_to_field(wallet);
            let wallet_settings = wallets_map.get(wallet_hash);
            if 1 >= wallet_settings.threshold {
                completed_signing_ops.set(wallet_signing_op_id_hash, true);
                // NOTE: We never remove from pending_signing_ops to ensure wallet_signing_op_id_hash is always unique
            }
        } else {
            pending_signing_ops.set(wallet_signing_op_id_hash, WalletSigningOp {
                wallet: wallet,
                confirmations: 0,
            });
        }
    }

    ///////////////////////////////////////////////////////////////////////////
    // Provide an Aleo signature to a signing operation
    ///////////////////////////////////////////////////////////////////////////

    async transition sign(public wallet_id: address, public signing_op_id: field) -> Future {
        let wallet = Wallet { wallet_owner: self.caller, wallet_id: wallet_id };
        let signer = WalletAleoSigner { wallet: wallet, user: self.signer };
        let signer_hash = BHP256::hash_to_field(signer);
        return finalize_sign(wallet, signing_op_id, signer_hash);
    }

    async function finalize_sign(wallet: Wallet, signing_op_id: field, signer_hash: field) {
        // Signer must be known.
       assert(signers_map.contains(signer_hash));

        // Signing op must exist.
        let wallet_signing_op_id_hash = BHP256::hash_to_field(WalletSigningOpId { wallet: wallet, signing_op_id: signing_op_id });
        assert(pending_signing_ops.contains(wallet_signing_op_id_hash));
        let signing_op = pending_signing_ops.get(wallet_signing_op_id_hash);

        // Track signer and ensure they cannot sign twice for the same operation.
        let confirmation_hash =  BHP256::hash_to_field(SigningOpConfirmation {
            wallet_signing_op_id_hash: wallet_signing_op_id_hash,
            wallet_signer_hash: signer_hash,
        });
        assert(!pending_signing_confirmations.contains(confirmation_hash));
        pending_signing_confirmations.set(confirmation_hash, true);

        // Increase confirmations
        let new_signing_op = WalletSigningOp {
            wallet: wallet,
            confirmations: signing_op.confirmations + 1,
        };
        pending_signing_ops.set(wallet_signing_op_id_hash, new_signing_op);

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

        // NOTE: We never remove from pending_signing_ops to ensure wallet_signing_op_id_hash is always unique
    }

    ///////////////////////////////////////////////////////////////////////////
    // Provide an ECDSA signature to a signing operation
    ///////////////////////////////////////////////////////////////////////////

    async transition sign_ecdsa(public wallet_id: address, public signing_op_id: field, public ecdsa_signer: [u8; 20], public sig: [u8; 65]) -> Future {
        let wallet = Wallet { wallet_owner: self.caller, wallet_id: wallet_id };
        let signer = WalletEcdsaSigner { wallet: wallet, ecdsa_signer: ecdsa_signer };

        return finalize_sign_ecdsa(wallet, signing_op_id, signer, sig);
    }

    async function finalize_sign_ecdsa(wallet: Wallet, signing_op_id: field, signer: WalletEcdsaSigner, sig: [u8; 65]) {
        // Signer must be known.
        let signer_hash = BHP256::hash_to_field(signer);
        assert(signers_map.contains(signer_hash));

        // Signing op must exist.
        let wallet_signing_op_id_hash = BHP256::hash_to_field(WalletSigningOpId { wallet: wallet, signing_op_id: signing_op_id });
        assert(pending_signing_ops.contains(wallet_signing_op_id_hash));
        let signing_op = pending_signing_ops.get(wallet_signing_op_id_hash);

        // Signature must be valid.
        let hash_bits: [bool; 253] = Serialize::to_bits_raw(wallet_signing_op_id_hash);
        let padded_bits: [bool; 256] = [false; 256];
        for i: u8 in 0..253 {
            padded_bits[i] = hash_bits[i];
        }
        let bytes = Deserialize::from_bits_raw::[[u8; 32]](padded_bits);
        let digest = to_eth_signed_message_hash(bytes);
        assert(ECDSA::verify_digest_eth(sig, signer.ecdsa_signer, digest));

        // Track signer and ensure they cannot sign twice for the same operation.
        let confirmation_hash =  BHP256::hash_to_field(SigningOpConfirmation {
            wallet_signing_op_id_hash: wallet_signing_op_id_hash,
            wallet_signer_hash: signer_hash,
        });
        assert(!pending_signing_confirmations.contains(confirmation_hash));
        pending_signing_confirmations.set(confirmation_hash, true);

        // Increase confirmations
        let new_signing_op = WalletSigningOp {
            wallet: wallet,
            confirmations: signing_op.confirmations + 1,
        };
        pending_signing_ops.set(wallet_signing_op_id_hash, new_signing_op);

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

        // NOTE: We never remove from pending_signing_ops to ensure wallet_signing_op_id_hash is always unique
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
        wallet_signer_hash: field,
    }

    function assert_valid_admin_op(admin_op: HashedAdminOp) {
        if (admin_op.op == ADMIN_OP_CHANGE_THRESHOLD) {
            assert_neq(admin_op.threshold, 0u8);
            assert_eq(admin_op.wallet_signer_hash, 0field);
        } else if (admin_op.op == ADMIN_OP_ADD_SIGNER || admin_op.op == ADMIN_OP_REMOVE_SIGNER) {
            assert_eq(admin_op.threshold, 0u8);
            assert_neq(admin_op.wallet_signer_hash, 0field);
        } else {
            assert(false);
        }
    }

    async transition exec_admin_op(public wallet_id: address, public admin_op: HashedAdminOp) -> Future {
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
            assert(!signers_map.contains(admin_op.wallet_signer_hash));

            let aleo_zero_wallet_signer = WalletAleoSigner { wallet: wallet, user: ALEO_ZERO_ADDRESS };
            let aleo_zero_wallet_signer_hash = BHP256::hash_to_field(aleo_zero_wallet_signer);
            assert_neq(admin_op.wallet_signer_hash, aleo_zero_wallet_signer_hash);

            let ecdsa_zero_wallet_signer = WalletEcdsaSigner { wallet: wallet, ecdsa_signer: ETH_ZERO_ADDRESS };
            let ecdsa_zero_wallet_signer_hash = BHP256::hash_to_field(ecdsa_zero_wallet_signer);
            assert_neq(admin_op.wallet_signer_hash, ecdsa_zero_wallet_signer_hash);

            signers_map.set(admin_op.wallet_signer_hash, true);

            wallets_map.set(wallet_hash, WalletSettings {
                threshold: wallet_settings.threshold,
                num_signers: wallet_settings.num_signers + 1
            });
        } else if (admin_op.op == ADMIN_OP_REMOVE_SIGNER) {
            assert(signers_map.contains(admin_op.wallet_signer_hash));
            signers_map.remove(admin_op.wallet_signer_hash);

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

    async transition assert_signing_completed(public wallet_id: address, public signing_op_id: field) -> Future {
        let wallet = Wallet { wallet_owner: self.caller, wallet_id: wallet_id };
        let fut = fin_assert_signing_completed(wallet, signing_op_id);
        return fut;
    }

    async function fin_assert_signing_completed(wallet: Wallet, signing_op_id: field) {
        let wallet_signing_op_id_hash = BHP256::hash_to_field(WalletSigningOpId { wallet: wallet, signing_op_id: signing_op_id });
        let signing_complete = completed_signing_ops.contains(wallet_signing_op_id_hash);
        assert(signing_complete);
    }

    inline to_eth_signed_message_hash(hash: [u8; 32]) -> [u8; 32] {
        let digest: [u8; 60] = [0u8; 60];

        // Ethereum Signed Message prefix: "\x19Ethereum Signed Message:\n32"
        digest[0] = 25u8;   // \x19
        digest[1] = 69u8;   // E
        digest[2] = 116u8;  // t
        digest[3] = 104u8;  // h
        digest[4] = 101u8;  // e
        digest[5] = 114u8;  // r
        digest[6] = 101u8;  // e
        digest[7] = 117u8;  // u
        digest[8] = 109u8;  // m
        digest[9] = 32u8;   // (space)
        digest[10] = 83u8;  // S
        digest[11] = 105u8; // i
        digest[12] = 103u8; // g
        digest[13] = 110u8; // n
        digest[14] = 101u8; // e
        digest[15] = 100u8; // d
        digest[16] = 32u8;  // (space)
        digest[17] = 77u8;  // M
        digest[18] = 101u8; // e
        digest[19] = 115u8; // s
        digest[20] = 115u8; // s
        digest[21] = 97u8;  // a
        digest[22] = 103u8; // g
        digest[23] = 101u8; // e
        digest[24] = 58u8;  // :
        digest[25] = 10u8;  // \n
        digest[26] = 51u8;  // '3'
        digest[27] = 50u8;  // '2'

        // Copy hash bytes (32 bytes)
        for i in 0u8..32u8 {
            digest[28u8 + i] = hash[i];
        }

        let hash_bits = Keccak256::hash_native_raw(digest);
        return Deserialize::from_bits_raw::[[u8; 32]](hash_bits);
    }
}