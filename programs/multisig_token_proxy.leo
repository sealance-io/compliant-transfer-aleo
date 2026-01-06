
import compliant_token_template.aleo;
import multisig_core.aleo;

program multisig_token_proxy.aleo {
    @custom
    async constructor() {
        // Only require multisig for upgrades - initial deployment has no checks.
        if self.edition > 0u16 {
            let signing_op_id = BHP256::hash_to_field(ChecksumEdition { checksum: self.checksum, edition: self.edition });

            let wallet_signing_op_id_hash = BHP256::hash_to_field(WalletSigningOpId { wallet_id: self.address, signing_op_id: signing_op_id });
            let signing_complete = multisig_core.aleo/completed_signing_ops.contains(wallet_signing_op_id_hash);
            assert(signing_complete);
        }
    }
    
    const ZERO_ADDRESS: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc; // ZERO_ADDRESS as field equals to 0field
    // Only this address can initialize the program
    const INITIAL_CONFIGURATION_ADDRESS: address = aleo1mh7al4qsedqvsh64pmmlcmzl5ugmrdxp4a4rdneja7etn8cpuspqvrj9q8;

    // Roles can be assigned using bitmasking to allow multiple roles per address
    const NONE_ROLE: u16 = 0u16;
    const MINTER_ROLE: u16 = 1u16;
    const BURNER_ROLE: u16 = 2u16;
    const PAUSE_ROLE: u16 = 4u16;   // can pause/unpause transfers
    const MANAGER_ROLE: u16 = 8u16; // can only assign roles
    // Maps each multisig wallet ID to its assigned role,
    // defining what actions that multisig wallet is authorized to perform.
    mapping wallet_id_to_role: address => u16;

    const INITIALIZED_INDEX: bool = true;
    // Indicates whether an address is frozen.
    mapping initialized: bool => bool;

    const MULTISIG_OP_UPDATE_WALLET_ROLE: u8 = 1u8;
    const MULTISIG_OP_UPDATE_ROLE: u8 = 2u8;
    const MULTISIG_OP_SET_PAUSE_STATUS: u8 = 3u8;
    const MULTISIG_OP_MINT_PUBLIC: u8 = 4u8;
    const MULTISIG_OP_BURN_PUBLIC: u8 = 5u8;
    const MULTISIG_OP_MINT_PRIVATE: u8 = 6u8;
    const MULTISIG_OP_BURN_PRIVATE: u8 = 7u8;

    struct ChecksumEdition {
        checksum: [u8; 32],
        edition: u16,
    }

    struct CompliantTokenMultisigOp {
        op: u8,

        // Only used for MULTISIG_OP_UPDATE_ROLE, MULTISIG_OP_MINT_PUBLIC, MULTISIG_OP_BURN_PUBLIC and MULTISIG_OP_UPDATE_WALLET_ROLE
        user: address,

        // Only used for MULTISIG_OP_MINT_PUBLIC and MULTISIG_OP_BURN_PUBLIC
        amount: u128,

        // Only used for MULTISIG_OP_UPDATE_ROLE and MULTISIG_OP_UPDATE_WALLET_ROLE
        role: u16,

        // Only used for MULTISIG_OP_SET_PAUSE_STATUS
        pause_status: bool,

        salt: scalar
    }

    struct PrivateCompliantTokenMultisigOp {
        op: u8,
        user: address,
        amount: u128,
    }

    struct MultisigCommonParams {
        wallet_id: address,
        salt: scalar
    }

    // Stores pending multisig requests, Keyed by hash(WalletSigningOpId) to uniquely identify each operation
    mapping pending_requests: field => CompliantTokenMultisigOp; // hash(WalletSigningOpId) => CompliantTokenMultisigOp;
    // Stores confidential pending multisig requests, Keyed by hash(WalletSigningOpId) to a boolean
    mapping private_pending_requests: field => bool; // hash(WalletSigningOpId) => bool;

    // A helper for calculating a signing_op_id from the program's checksum and edition.
    // By deriving the signing_op_id from both we ensure that downgrades cannot take place.
    transition get_signing_op_id_for_deploy(checksum: [u8; 32], edition: u16) -> field {
        return BHP256::hash_to_field(ChecksumEdition { checksum: checksum, edition: edition });
    }

    // Initializes a new multisig operation.
    // Computes the signing_op_id, registers it with the external multisig wallet,
    // and stores the CompliantTokenMultisigOp under the hashed wallet operation ID.
    // Fails if an operation with the same ID already exists unless this request is expired.
    // Can only be called after the token has been initialized.
    async transition init_multisig_op(wallet_id: address, multisig_op: CompliantTokenMultisigOp, public block_expiration: u32) -> (field, field, Future) {
        let signing_op_id = BHP256::hash_to_field(multisig_op);
        let (wallet_signing_op_id_hash, init_signing_op_fut) = multisig_core.aleo/initiate_signing_op(wallet_id, signing_op_id, block_expiration);
        return (signing_op_id, wallet_signing_op_id_hash, fin_init_multisig_op(
            wallet_signing_op_id_hash,
            multisig_op,
            init_signing_op_fut
        ));
    }
    async function fin_init_multisig_op(
        wallet_signing_op_id_hash: field,
        multisig_op: CompliantTokenMultisigOp,
        init_signing_op_fut: Future,
    ) {
        let is_already_initialized: bool = initialized.get_or_use(INITIALIZED_INDEX, false);
        assert_eq(is_already_initialized, true);

        let already_requested: bool = pending_requests.contains(wallet_signing_op_id_hash);
        if (already_requested) {
            let existing_pending_op = multisig_core.aleo/pending_signing_ops.get(wallet_signing_op_id_hash);
            assert(existing_pending_op.expires_at_block < block.height);
        }

        pending_requests.set(wallet_signing_op_id_hash, multisig_op);
        init_signing_op_fut.await();
    }

        // Initializes a new private multisig operation.
    // Commits the private multisig payload with a salt to compute signing_op_id.
    // Registers it with the external multisig wallet.
    // Stores `true` under the hashed wallet operation ID.
    // Fails if an operation with the same ID already exists unless this request is expired.
    // Can only be called after the token has been initialized.
    async transition init_private_multisig_op(wallet_id: address, multisig_op: PrivateCompliantTokenMultisigOp, salt: scalar, public block_expiration: u32) -> (field, field, Future) {
        let signing_op_id = BHP256::commit_to_field(multisig_op, salt);
        let (wallet_signing_op_id_hash, init_signing_op_fut) = multisig_core.aleo/initiate_signing_op(wallet_id, signing_op_id, block_expiration);
        return (signing_op_id, wallet_signing_op_id_hash, fin_init_private_multisig_op(
            wallet_signing_op_id_hash,
            init_signing_op_fut
        ));
    }
    async function fin_init_private_multisig_op(
        wallet_signing_op_id_hash: field,
        init_signing_op_fut: Future,
    ) {
        // Check if the token has already been initialized
        let is_already_initialized: bool = initialized.get_or_use(INITIALIZED_INDEX, false);
        assert_eq(is_already_initialized, true);

        let already_requested: bool = private_pending_requests.contains(wallet_signing_op_id_hash);
        if(already_requested) {
            let existing_pending_op = multisig_core.aleo/pending_signing_ops.get(wallet_signing_op_id_hash);
            assert(existing_pending_op.expires_at_block < block.height);
        }
        assert(!pending_requests.contains(wallet_signing_op_id_hash));
        private_pending_requests.set(wallet_signing_op_id_hash, true);
        init_signing_op_fut.await();
    }

    // Initializes the freeze list and the admin.
    // Can only be called once — ensures the contract has not already been initialized.
    // Can be called only by the INITIAL_CONFIGURATION_ADDRESS
    // Sets the block height window, the initial empty Merkle root,
    // and initialize the freeze_list_last_index, freeze_list, and freeze_list_index with a ZERO_ADDRESS placeholder.
    async transition initialize(public manager_wallet_id: address) -> Future {
        return f_initialize(
            self.caller, 
            manager_wallet_id
        );
    }
    async function f_initialize(
        caller: address, 
        manager_wallet_id: address,
    ) {
        assert_eq(caller, INITIAL_CONFIGURATION_ADDRESS);

        let is_already_initialized: bool = initialized.get_or_use(INITIALIZED_INDEX, false);
        assert_eq(is_already_initialized, false);

        initialized.set(INITIALIZED_INDEX, true);

        assert_neq(manager_wallet_id, ZERO_ADDRESS);
        wallet_id_to_role.set(manager_wallet_id, MANAGER_ROLE);
    }

    // Updates the wallet_id assigned to a given role.
    // Generates wallet_signing_op_id_hash using the parameters
    // Can be executed directly by an address with the manager role,
    // or by any caller if the corresponding multisig update wallet id request was approved and it is not expired.
    async transition update_wallet_id_role(public target_wallet_id: address, public role: u16, public multisig_common_params: MultisigCommonParams) -> Future {
        let multisig_op: CompliantTokenMultisigOp = CompliantTokenMultisigOp {
            op: MULTISIG_OP_UPDATE_WALLET_ROLE,
            pause_status: false,
            user: target_wallet_id,
            role: role,
            amount: 0u128,
            salt: multisig_common_params.salt
        };
        let signing_op_id = BHP256::hash_to_field(multisig_op);
        let wallet_signing_op_id_hash = multisig_core.aleo/get_signing_op_id_hash_fn(multisig_common_params.wallet_id, signing_op_id);

        return f_update_wallet_id_role(target_wallet_id, role, wallet_signing_op_id_hash, multisig_op, multisig_common_params.wallet_id);
    }
    async function f_update_wallet_id_role(target_wallet_id: address, new_role: u16, wallet_signing_op_id_hash: field, multisig_op: CompliantTokenMultisigOp, wallet_id: address) {
        let wallet_id_role = wallet_id_to_role.get(wallet_id);
        assert(wallet_id_role & MANAGER_ROLE == MANAGER_ROLE);
        let signing_complete = multisig_core.aleo/completed_signing_ops.contains(wallet_signing_op_id_hash);
        assert(signing_complete);
        let pending_signing_op = multisig_core.aleo/pending_signing_ops.get(wallet_signing_op_id_hash);
        assert(pending_signing_op.expires_at_block > block.height);
        let pending_request = pending_requests.get(wallet_signing_op_id_hash);
        assert_eq(pending_request, multisig_op);
        pending_requests.remove(wallet_signing_op_id_hash);
        if (wallet_id == target_wallet_id) { 
            assert(new_role & MANAGER_ROLE == MANAGER_ROLE); 
        }
        
        wallet_id_to_role.set(target_wallet_id, new_role);
    }

    // Updates the address assigned to a given role.
    // Generates wallet_signing_op_id_hash using the parameters
    // Can be executed directly by an address with the manager role,
    // or by any caller if the corresponding multisig update role request was approved and it is not expired.
    // Ensures the caller retains manager privileges, preventing a state with no active managers.
    async transition update_role(public new_address: address, public role: u16, public multisig_common_params: MultisigCommonParams) -> Future {
        let multisig_op: CompliantTokenMultisigOp = CompliantTokenMultisigOp {
            op: MULTISIG_OP_UPDATE_ROLE,
            pause_status: false,
            user: new_address,
            role: role,
            amount: 0u128,
            salt: multisig_common_params.salt
        };
        let signing_op_id = BHP256::hash_to_field(multisig_op);
        let wallet_signing_op_id_hash = multisig_core.aleo/get_signing_op_id_hash_fn(multisig_common_params.wallet_id, signing_op_id);

        let compliant_token_template_call: Future = compliant_token_template.aleo/update_role(new_address, role);

        return f_update_role(wallet_signing_op_id_hash, multisig_op, multisig_common_params.wallet_id, compliant_token_template_call);
    }
    async function f_update_role(
        wallet_signing_op_id_hash: field,
        multisig_op: CompliantTokenMultisigOp,
        wallet_id: address,
        compliant_token_template_call: Future
    ) {
        let wallet_id_role = wallet_id_to_role.get(wallet_id);
        assert(wallet_id_role & MANAGER_ROLE == MANAGER_ROLE);
        let signing_complete = multisig_core.aleo/completed_signing_ops.contains(wallet_signing_op_id_hash);
        assert(signing_complete);
        let pending_signing_op = multisig_core.aleo/pending_signing_ops.get(wallet_signing_op_id_hash);
        assert(pending_signing_op.expires_at_block > block.height);
        let pending_request = pending_requests.get(wallet_signing_op_id_hash);
        assert_eq(pending_request, multisig_op);
        pending_requests.remove(wallet_signing_op_id_hash);
        
        compliant_token_template_call.await();
    }

        // Mints new public tokens to the specified recipient’s balance.
    // Generates wallet_signing_op_id_hash using the parameters
    // Can be executed by by any caller if the corresponding multisig mint public request was approved and it is not expired.
    // Ensures that the new total supply does not exceed the maximum supply.
    // Updates the recipient’s balance and the total token supply in the token metadata.
    async transition mint_public(
        public recipient: address,
        public amount: u128,
        public multisig_common_params: MultisigCommonParams
    ) -> Future {
        let multisig_op: CompliantTokenMultisigOp = CompliantTokenMultisigOp {
            op: MULTISIG_OP_MINT_PUBLIC,
            pause_status: false,
            user: recipient,
            role: 0u16,
            amount: amount, 
            salt: multisig_common_params.salt
        };
        let signing_op_id = BHP256::hash_to_field(multisig_op);
        let wallet_signing_op_id_hash = multisig_core.aleo/get_signing_op_id_hash_fn(multisig_common_params.wallet_id, signing_op_id);

        let compliant_token_template_call: Future = compliant_token_template.aleo/mint_public(recipient, amount);

        return finalize_mint_public(wallet_signing_op_id_hash, multisig_op, multisig_common_params.wallet_id, compliant_token_template_call);
    }
    async function finalize_mint_public(
        wallet_signing_op_id_hash: field,
        multisig_op: CompliantTokenMultisigOp,
        wallet_id: address,
        compliant_token_template_call: Future
    ) {
        let wallet_id_role = wallet_id_to_role.get(wallet_id);
        assert(wallet_id_role & MINTER_ROLE == MINTER_ROLE);
        let signing_complete = multisig_core.aleo/completed_signing_ops.contains(wallet_signing_op_id_hash);
        assert(signing_complete);
        let pending_signing_op = multisig_core.aleo/pending_signing_ops.get(wallet_signing_op_id_hash);
        assert(pending_signing_op.expires_at_block > block.height);
        let pending_request = pending_requests.get(wallet_signing_op_id_hash);
        assert_eq(pending_request, multisig_op);
        pending_requests.remove(wallet_signing_op_id_hash);

        compliant_token_template_call.await();
    }

        // Mints new private tokens to the specified recipient.
    // Generates wallet_signing_op_id_hash using the parameters
    // Can be executed by any caller if the corresponding multisig mint private request was approved and it is not expired.
    // Ensures that the new total supply does not exceed the maximum supply.
    // Updates the total token supply in the token metadata.
    async transition mint_private(
        recipient: address,
        public amount: u128,
        multisig_common_params: MultisigCommonParams
        ) -> (compliant_token_template.aleo/ComplianceRecord, compliant_token_template.aleo/Token, Future) {
        let multisig_op: PrivateCompliantTokenMultisigOp = PrivateCompliantTokenMultisigOp {
            op: MULTISIG_OP_MINT_PRIVATE,
            user: recipient,
            amount: amount
        };
        let signing_op_id = BHP256::commit_to_field(multisig_op, multisig_common_params.salt);
        let wallet_signing_op_id_hash = multisig_core.aleo/get_signing_op_id_hash_fn(multisig_common_params.wallet_id, signing_op_id);
        
        let compliant_token_template_call: (compliant_token_template.aleo/ComplianceRecord, compliant_token_template.aleo/Token, Future) = compliant_token_template.aleo/mint_private(recipient, amount);

        return (compliant_token_template_call.0, compliant_token_template_call.1, finalize_mint_private(wallet_signing_op_id_hash, multisig_common_params.wallet_id, compliant_token_template_call.2));
    }
    async function finalize_mint_private(
        wallet_signing_op_id_hash: field,
        wallet_id: address,
        compliant_token_template_call: Future
    ) {
        let wallet_id_role = wallet_id_to_role.get(wallet_id);
        assert(wallet_id_role & MINTER_ROLE == MINTER_ROLE);
        let signing_complete = multisig_core.aleo/completed_signing_ops.contains(wallet_signing_op_id_hash);
        assert(signing_complete);
        let pending_signing_op = multisig_core.aleo/pending_signing_ops.get(wallet_signing_op_id_hash);
        assert(pending_signing_op.expires_at_block > block.height);
        assert(private_pending_requests.contains(wallet_signing_op_id_hash));
        private_pending_requests.remove(wallet_signing_op_id_hash);

        compliant_token_template_call.await();
    }

    // Burns public tokens from the specified owner’s balance.
    // Generates wallet_signing_op_id_hash using the parameters
    // Can be executed by any caller if the corresponding multisig burn public request was approved and it is not expired.
    // Decreases the owner’s balance and reduces the total token supply in the token metadata.
    async transition burn_public(
        public owner: address,
        public amount: u128,
        public multisig_common_params: MultisigCommonParams
    ) -> Future {
        let multisig_op: CompliantTokenMultisigOp = CompliantTokenMultisigOp {
            op: MULTISIG_OP_BURN_PUBLIC,
            pause_status: false,
            user: owner,
            role: 0u16,
            amount: amount,
            salt: multisig_common_params.salt
        };
        let signing_op_id = BHP256::hash_to_field(multisig_op);
        let wallet_signing_op_id_hash = multisig_core.aleo/get_signing_op_id_hash_fn(multisig_common_params.wallet_id, signing_op_id);
        let compliant_token_template_call: Future = compliant_token_template.aleo/burn_public(owner, amount);
        return finalize_burn_public( wallet_signing_op_id_hash, multisig_op, multisig_common_params.wallet_id, compliant_token_template_call);
    }
    async function finalize_burn_public(
        wallet_signing_op_id_hash: field,
        multisig_op: CompliantTokenMultisigOp,
        wallet_id: address,
        compliant_token_template_call: Future
    ) {
        let wallet_id_role = wallet_id_to_role.get(wallet_id);
        assert(wallet_id_role & BURNER_ROLE == BURNER_ROLE);
        let signing_complete = multisig_core.aleo/completed_signing_ops.contains(wallet_signing_op_id_hash);
        assert(signing_complete);
        let pending_signing_op = multisig_core.aleo/pending_signing_ops.get(wallet_signing_op_id_hash);
        assert(pending_signing_op.expires_at_block > block.height);
        let pending_request = pending_requests.get(wallet_signing_op_id_hash);
        assert_eq(pending_request, multisig_op);
        pending_requests.remove(wallet_signing_op_id_hash);

        compliant_token_template_call.await();
    }

        // Burns tokens from a private record (non-public asset).
    // Generates wallet_signing_op_id_hash using the parameters
    // Can be executed by any caller if the corresponding multisig burn private request was approved and it is not expired.
    // Reduces the amount in the provided private record and decreases the total token supply in the token metadata.
    async transition burn_private(
        input_record: compliant_token_template.aleo/Token,
        public amount: u128,
        multisig_common_params: MultisigCommonParams
    ) -> (compliant_token_template.aleo/ComplianceRecord, compliant_token_template.aleo/Token, Future) {
        let multisig_op: PrivateCompliantTokenMultisigOp = PrivateCompliantTokenMultisigOp {
            op: MULTISIG_OP_BURN_PRIVATE,
            user: input_record.owner,
            amount: amount
        };
        let signing_op_id = BHP256::commit_to_field(multisig_op, multisig_common_params.salt);
        let wallet_signing_op_id_hash = multisig_core.aleo/get_signing_op_id_hash_fn(multisig_common_params.wallet_id, signing_op_id);

        let compliant_token_template_call: (compliant_token_template.aleo/ComplianceRecord, compliant_token_template.aleo/Token, Future) = compliant_token_template.aleo/burn_private(input_record, amount);

        return (compliant_token_template_call.0, compliant_token_template_call.1, finalize_burn_private(wallet_signing_op_id_hash, multisig_common_params.wallet_id, compliant_token_template_call.2));
    }
    async function finalize_burn_private(
        wallet_signing_op_id_hash: field,
        wallet_id: address,
        compliant_token_template_call: Future
    ) {
        let wallet_id_role = wallet_id_to_role.get(wallet_id);
        assert(wallet_id_role & BURNER_ROLE == BURNER_ROLE);
        let signing_complete = multisig_core.aleo/completed_signing_ops.contains(wallet_signing_op_id_hash);
        assert(signing_complete);
        let pending_signing_op = multisig_core.aleo/pending_signing_ops.get(wallet_signing_op_id_hash);
        assert(pending_signing_op.expires_at_block > block.height);
        assert(private_pending_requests.contains(wallet_signing_op_id_hash));
        private_pending_requests.remove(wallet_signing_op_id_hash);

        compliant_token_template_call.await();
    }

    // Stops or resumes all token transfers.
    // Generates wallet_signing_op_id_hash using the parameters
    // Can be executed directly by an address with the pause role,
    // or by any caller if the corresponding multisig set pause status request was approved and it is not expired.
    async transition set_pause_status(public pause_status: bool, public multisig_common_params: MultisigCommonParams) -> Future {
        let multisig_op: CompliantTokenMultisigOp = CompliantTokenMultisigOp {
            op: MULTISIG_OP_SET_PAUSE_STATUS,
            pause_status: pause_status,
            user: ZERO_ADDRESS,
            role: 0u16,
            amount: 0u128,
            salt: multisig_common_params.salt
        };
        let signing_op_id = BHP256::hash_to_field(multisig_op);
        let wallet_signing_op_id_hash = multisig_core.aleo/get_signing_op_id_hash_fn(multisig_common_params.wallet_id, signing_op_id);
        let compliant_token_template_call: Future = compliant_token_template.aleo/set_pause_status(pause_status);

        return f_set_pause_status(wallet_signing_op_id_hash, multisig_op, multisig_common_params.wallet_id, compliant_token_template_call);
    }
    async function f_set_pause_status(
        wallet_signing_op_id_hash: field,
        multisig_op: CompliantTokenMultisigOp,
        wallet_id: address,
        compliant_token_template_call: Future
    ) {
        let wallet_id_role = wallet_id_to_role.get(wallet_id);
        assert(wallet_id_role & PAUSE_ROLE == PAUSE_ROLE);
        let signing_complete = multisig_core.aleo/completed_signing_ops.contains(wallet_signing_op_id_hash);
        assert(signing_complete);
        let pending_signing_op = multisig_core.aleo/pending_signing_ops.get(wallet_signing_op_id_hash);
        assert(pending_signing_op.expires_at_block > block.height);
        let pending_request = pending_requests.get(wallet_signing_op_id_hash);
        assert_eq(pending_request, multisig_op);
        pending_requests.remove(wallet_signing_op_id_hash);

        compliant_token_template_call.await();
    }
}