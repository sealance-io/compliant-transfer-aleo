import multisig_impl.aleo;

// The 'multisig' program.
program multisig.aleo {
    const ZERO_ADDRESS: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;

    //@noupgrade
    @admin(address="aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px")
    async constructor() {}

    ///////////////////////////////////////////////////////////////////////////


    ///////////////////////////////////////////////////////////////////////////
    // Create a new multisig wallet
    ///////////////////////////////////////////////////////////////////////////

    async transition create_wallet(wallet_id: address, threshold: u8, signers: [address; 4]) -> Future {
        let fut = multisig_impl.aleo/create_wallet(wallet_id, threshold, signers);
        return finalize_create_wallet(fut);
    }

    async function finalize_create_wallet(fut: Future) {
        fut.await();
    }

    ///////////////////////////////////////////////////////////////////////////
    // Begin a signing operation
    ///////////////////////////////////////////////////////////////////////////
    async transition initiate_signing_op(wallet_id: address, signing_op_id: field) -> (field, Future) {
        let (wallet_signing_op_id_hash, fut) = multisig_impl.aleo/initiate_signing_op(wallet_id, signing_op_id);
        return (wallet_signing_op_id_hash, finalize_initiate_signing_op(fut));
    }

    async function finalize_initiate_signing_op(fut: Future) {
       fut.await();
    }

    ///////////////////////////////////////////////////////////////////////////
    // Provide a signature to a signing operation
    ///////////////////////////////////////////////////////////////////////////
    async transition sign(wallet_id: address, signing_op_id: field) -> Future {
        let fut = multisig_impl.aleo/sign(wallet_id, signing_op_id);
        return finalize_sign(fut);
    }

    async function finalize_sign(fut: Future) {
        fut.await();
    }

    ///////////////////////////////////////////////////////////////////////////
    // Perform an admin operation
    ///////////////////////////////////////////////////////////////////////////

    // An administrative operation
    struct AdminOp {
        op: u8,

        // Only used for ADMIN_OP_CHANGE_THRESHOLD
        threshold: u8,

        // Only used for ADMIN_OP_ADD_SIGNER and ADMIN_OP_REMOVE_SIGNER
        user: address,
    }


    function hash_admin_op(wallet: Wallet, admin_op: AdminOp) -> HashedAdminOp {
        let wallet_user_hash = (admin_op.user == ZERO_ADDRESS) ? 0field : BHP256::hash_to_field(WalletUser {
            wallet: wallet,
            user: admin_op.user,
        });
        return HashedAdminOp {
            op: admin_op.op,
            threshold: admin_op.threshold,
            wallet_user_hash: wallet_user_hash,
        };
    }


   mapping pending_admin_ops: field => HashedAdminOp; // hash(WalletSigningOpId) => HashedAdminOp

   async transition init_admin_op(wallet_id: address, signing_op_id: field, admin_op: AdminOp) -> (field, Future) {
        let wallet = Wallet { wallet_owner: self.address, wallet_id: wallet_id };
        let hashed_admin_op = hash_admin_op(wallet, admin_op);

        multisig_impl.aleo/assert_valid_admin_op(hashed_admin_op);

        let (wallet_signing_op_id_hash, init_signing_op_fut) = multisig_impl.aleo/initiate_signing_op(wallet_id, signing_op_id);
        return (wallet_signing_op_id_hash, fin_init_admin_op(
            wallet_id,
            wallet_signing_op_id_hash,
            hashed_admin_op,
            init_signing_op_fut
        ));
    }

    async function fin_init_admin_op(wallet_id: address, wallet_signing_op_id_hash: field, hashed_admin_op: HashedAdminOp, init_signing_op_fut: Future) {
        assert(!pending_admin_ops.contains(wallet_signing_op_id_hash));

        pending_admin_ops.set(wallet_signing_op_id_hash, hashed_admin_op);
        init_signing_op_fut.await();
    }

    async transition exec_admin_op(wallet_id: address, signing_op_id: field, admin_op: AdminOp) -> Future {
        let wallet = Wallet { wallet_owner: self.address, wallet_id: wallet_id };
        let hashed_admin_op = hash_admin_op(wallet, admin_op);

        let signing_complete_fut = multisig_impl.aleo/assert_signing_completed(wallet_id, signing_op_id);
        let exec_admin_op_fut = multisig_impl.aleo/exec_admin_op(wallet_id, hashed_admin_op);

        let wallet_signing_op_id_hash = get_signing_op_id_hash_fn(wallet_id, signing_op_id);

        return fin_exec_admin_op(wallet_signing_op_id_hash, wallet_id, signing_op_id, hashed_admin_op, signing_complete_fut, exec_admin_op_fut);
    }

    async function fin_exec_admin_op(wallet_signing_op_id_hash: field, wallet_id: address, signing_op_id: field, hashed_admin_op: HashedAdminOp, signing_complete_fut: Future, exec_admin_op_fut: Future) {
        // Signing must be completed.
        signing_complete_fut.await();

        // The signing op must match the stored one.
        let pending_admin_op = pending_admin_ops.get(wallet_signing_op_id_hash);
        assert_eq(pending_admin_op, hashed_admin_op);

        // Execute
        exec_admin_op_fut.await();

        // Removing is crucial, otherwise the operation can be executed twice.
        pending_admin_ops.remove(wallet_signing_op_id_hash);
    }

    ///////////////////////////////////////////////////////////////////////////
    // Helpers
    ///////////////////////////////////////////////////////////////////////////

    function get_signing_op_id_hash_fn(wallet_id: address, signing_op_id: field) -> field {
        let wallet = Wallet { wallet_owner: self.address, wallet_id: wallet_id };
        return BHP256::hash_to_field(WalletSigningOpId { wallet: wallet, signing_op_id: signing_op_id });

    }

    transition get_signing_op_id_hash(wallet_id: address, signing_op_id: field) -> field {
        return get_signing_op_id_hash_fn(wallet_id, signing_op_id);
    }

    transition get_wallet_hash(wallet_id: address) -> field {
        let wallet = Wallet { wallet_owner: self.address, wallet_id: wallet_id };
        return BHP256::hash_to_field(wallet);
    }

    async transition assert_signing_completed(wallet_id: address, signing_op_id: field) -> Future {
        let fut = multisig_impl.aleo/assert_signing_completed(wallet_id, signing_op_id);
        return fin_assert_signing_completed(fut);
    }

    async function fin_assert_signing_completed(fut: Future) {
        fut.await();
    }

}