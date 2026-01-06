
import merkle_tree.aleo;
import multisig_core.aleo;

program multisig_freezelist_registry.aleo {
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
    const EMPTY_ROOT: field = 3642222252059314292809609689035560016959342421640560347114299934615987159853field; // hash of H(ZERO_ADDRESS, ZERO_ADDRESS)
    // Only this address can initialize the program
    const INITIAL_CONFIGURATION_ADDRESS: address = aleo1mh7al4qsedqvsh64pmmlcmzl5ugmrdxp4a4rdneja7etn8cpuspqvrj9q8;

    // Roles can be assigned using bitmasking to allow multiple roles per address
    const NONE_ROLE: u16 = 0u16;
    const MANAGER_ROLE: u16 = 8u16; // can only assign roles
    const FREEZELIST_MANAGER_ROLE: u16 = 16u16; // can update the freeze list
    mapping address_to_role: address => u16;
    // Maps each multisig wallet ID to its assigned role,
    // defining what actions that multisig wallet is authorized to perform.
    mapping wallet_id_to_role: address => u16;

    const CURRENT_FREEZE_LIST_ROOT_INDEX: u8 = 1u8;
    const PREVIOUS_FREEZE_LIST_ROOT_INDEX: u8 = 2u8;
    const ROOT_UPDATED_HEIGHT_INDEX: bool = true;
    const BLOCK_HEIGHT_WINDOW_INDEX: bool = true;
    const FREEZE_LIST_LAST_INDEX: bool = true;

    // Indicates whether an address is frozen.
    mapping freeze_list: address => bool;
    // Mimics an array of frozen addresses by storing them at sequential indexes.
    mapping freeze_list_index: u32 => address;
    // Stores the highest index used in the freeze_list_index mapping.
    mapping freeze_list_last_index: bool => u32;
    // Stores the current and previous Merkle roots of the freeze list (e.g., 1 = current, 2 = previous).
    mapping freeze_list_root: u8 => field;
    // Stores the block height when the root was updated.
    mapping root_updated_height: bool => u32;
    // Defines the number of blocks during which the previous root is still considered valid.
    mapping block_height_window: bool => u32;

    const MULTISIG_OP_UPDATE_WALLET_ROLE: u8 = 1u8;
    const MULTISIG_OP_UPDATE_ROLE: u8 = 2u8;
    const MULTISIG_OP_UPDATE_BLOCK_WINDOW: u8 = 3u8;
    const MULTISIG_OP_UPDATE_FREEZE_LIST: u8 = 4u8;

    struct ChecksumEdition {
        checksum: [u8; 32],
        edition: u16,
    }

    struct FreezeRegistryMultisigOp {
        op: u8,

        // Used for MULTISIG_OP_UPDATE_FREEZE_LIST and MULTISIG_OP_UPDATE_ROLE
        user: address,

        // Only used for MULTISIG_OP_UPDATE_FREEZE_LIST
        is_frozen: bool, 
        frozen_index: u32, 
        previous_root: field,
        new_root: field,

        // Only used for MULTISIG_OP_UPDATE_ROLE
        role: u16,

        // Only used for MULTISIG_OP_UPDATE_BLOCK_WINDOW
        blocks: u32,

        salt: scalar
    }

    struct MultisigCommonParams {
        wallet_id: address,
        salt: scalar
    }

    // Stores pending multisig requests, Keyed by hash(WalletSigningOpId) to uniquely identify each operation
    mapping pending_requests: field => FreezeRegistryMultisigOp; // hash(WalletSigningOpId) => FreezeRegistryMultisigOp;

    // A helper for calculating a signing_op_id from the program's checksum and edition.
    // By deriving the signing_op_id from both we ensure that downgrades cannot take place.
    transition get_signing_op_id_for_deploy(checksum: [u8; 32], edition: u16) -> field {
        return BHP256::hash_to_field(ChecksumEdition { checksum: checksum, edition: edition });
    }

    // Initializes a new multisig operation.
    // Computes the signing_op_id, registers it with the external multisig wallet,
    // and stores the FreezeRegistryMultisigOp under the hashed wallet operation ID.
    // Fails if an operation with the same ID already exists unless this request is expired.
    // Can only be called after the token has been initialized.
    async transition init_multisig_op(wallet_id: address, multisig_op: FreezeRegistryMultisigOp, public block_expiration: u32) -> (field, field, Future) {
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
        multisig_op: FreezeRegistryMultisigOp,
        init_signing_op_fut: Future,
    ) {
        let is_already_initialized: bool = freeze_list_root.contains(CURRENT_FREEZE_LIST_ROOT_INDEX);
        assert_eq(is_already_initialized, true);

        let already_requested: bool = pending_requests.contains(wallet_signing_op_id_hash);
        if (already_requested) {
            let existing_pending_op = multisig_core.aleo/pending_signing_ops.get(wallet_signing_op_id_hash);
            assert(existing_pending_op.expires_at_block < block.height);
        }

        pending_requests.set(wallet_signing_op_id_hash, multisig_op);
        init_signing_op_fut.await();
    }

    // Initializes the freeze list and the admin.
    // Can only be called once — ensures the contract has not already been initialized.
    // Can be called only by the INITIAL_CONFIGURATION_ADDRESS
    // Sets the block height window, the initial empty Merkle root,
    // and initialize the freeze_list_last_index, freeze_list, and freeze_list_index with a ZERO_ADDRESS placeholder.
    async transition initialize(public admin: address, public blocks: u32, public manager_wallet_id: address) -> Future {
        return f_initialize(
            admin, 
            self.caller, 
            blocks,
            manager_wallet_id
        );
    }
    async function f_initialize(
        admin: address, 
        caller: address, 
        blocks: u32,
        manager_wallet_id: address,
    ) {
        let is_already_initialized: bool = freeze_list_root.contains(CURRENT_FREEZE_LIST_ROOT_INDEX);
        assert_eq(is_already_initialized, false);

        assert_eq(caller, INITIAL_CONFIGURATION_ADDRESS);

        assert(admin != ZERO_ADDRESS || manager_wallet_id != ZERO_ADDRESS);
        if (admin != ZERO_ADDRESS) {
            address_to_role.set(admin, MANAGER_ROLE);
        }
        if (manager_wallet_id != ZERO_ADDRESS) {
            wallet_id_to_role.set(manager_wallet_id, MANAGER_ROLE);
        }

        block_height_window.set(BLOCK_HEIGHT_WINDOW_INDEX, blocks);
        freeze_list_last_index.set(FREEZE_LIST_LAST_INDEX, 0u32);
        freeze_list_root.set(CURRENT_FREEZE_LIST_ROOT_INDEX, EMPTY_ROOT);
        freeze_list.set(ZERO_ADDRESS, false);
        freeze_list_index.set(0u32, ZERO_ADDRESS);
    }

    // Updates the wallet_id assigned to a given role.
    // Generates wallet_signing_op_id_hash using the parameters
    // Can be executed directly by an address with the manager role,
    // or by any caller if the corresponding multisig update wallet id request was approved and it is not expired.
    async transition update_wallet_id_role(public target_wallet_id: address, public role: u16, public multisig_common_params: MultisigCommonParams) -> Future {
        let multisig_op: FreezeRegistryMultisigOp = FreezeRegistryMultisigOp {
            op: MULTISIG_OP_UPDATE_WALLET_ROLE,
            user: target_wallet_id,
            is_frozen: false, 
            frozen_index: 0u32, 
            previous_root: 0field,
            new_root: 0field,
            role: role,
            blocks: 0u32, 
            salt: multisig_common_params.salt
        };
        let signing_op_id = BHP256::hash_to_field(multisig_op);
        let wallet_signing_op_id_hash = multisig_core.aleo/get_signing_op_id_hash_fn(multisig_common_params.wallet_id, signing_op_id);

        return f_update_wallet_id_role(target_wallet_id, self.caller, role, wallet_signing_op_id_hash, multisig_op, multisig_common_params.wallet_id);
    }
    async function f_update_wallet_id_role(target_wallet_id: address, caller: address, new_role: u16, wallet_signing_op_id_hash: field, multisig_op: FreezeRegistryMultisigOp, wallet_id: address) {
        if (wallet_id != ZERO_ADDRESS) {
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
        } else {
            assert_eq(multisig_op.salt, 0scalar);
            let current_role: u16 = address_to_role.get(caller);
            assert(current_role & MANAGER_ROLE == MANAGER_ROLE);
        }
        
        wallet_id_to_role.set(target_wallet_id, new_role);
    }

    // Updates the address assigned to a given role.
    // Generates wallet_signing_op_id_hash using the parameters
    // Can be executed directly by an address with the manager role,
    // or by any caller if the corresponding multisig update role request was approved and it is not expired.
    // Ensures the caller retains manager privileges, preventing a state with no active managers.
    async transition update_role(public new_address: address, public role: u16, public multisig_common_params: MultisigCommonParams) -> Future {
        let multisig_op: FreezeRegistryMultisigOp = FreezeRegistryMultisigOp {
            op: MULTISIG_OP_UPDATE_ROLE,
            user: new_address,
            is_frozen: false, 
            frozen_index: 0u32, 
            previous_root: 0field,
            new_root: 0field,
            role: role,
            blocks: 0u32,
            salt: multisig_common_params.salt
        };
        let signing_op_id = BHP256::hash_to_field(multisig_op);
        let wallet_signing_op_id_hash = multisig_core.aleo/get_signing_op_id_hash_fn(multisig_common_params.wallet_id, signing_op_id);

        return f_update_role(new_address, self.caller, role, wallet_signing_op_id_hash, multisig_op, multisig_common_params.wallet_id);
    }

    async function f_update_role(
        new_address: address, 
        caller: address, 
        new_role: u16,
        wallet_signing_op_id_hash: field,
        multisig_op: FreezeRegistryMultisigOp,
        wallet_id: address
    ) {
        if (wallet_id != ZERO_ADDRESS) {
            let wallet_id_role = wallet_id_to_role.get(wallet_id);
            assert(wallet_id_role & MANAGER_ROLE == MANAGER_ROLE);
            let signing_complete = multisig_core.aleo/completed_signing_ops.contains(wallet_signing_op_id_hash);
            assert(signing_complete);
            let pending_signing_op = multisig_core.aleo/pending_signing_ops.get(wallet_signing_op_id_hash);
            assert(pending_signing_op.expires_at_block > block.height);
            let pending_request = pending_requests.get(wallet_signing_op_id_hash);
            assert_eq(pending_request, multisig_op);
            pending_requests.remove(wallet_signing_op_id_hash);
        } else {
            assert_eq(multisig_op.salt, 0scalar);
            let current_role: u16 = address_to_role.get(caller);
            assert(current_role & MANAGER_ROLE == MANAGER_ROLE);
            if (caller == new_address) { 
                assert(new_role & MANAGER_ROLE == MANAGER_ROLE); 
            }
        }
        
        address_to_role.set(new_address, new_role);
    }

    // Updates the number of blocks during which the previous root is still considered valid.
    // Generates wallet_signing_op_id_hash using the parameters
    // Can be executed directly by an address with the freeze list manager role,
    // or by any caller if the corresponding multisig update block height window request was approved  and it is not expired..
    async transition update_block_height_window(public blocks: u32, public multisig_common_params: MultisigCommonParams) -> Future {
        let multisig_op: FreezeRegistryMultisigOp = FreezeRegistryMultisigOp {
            op: MULTISIG_OP_UPDATE_BLOCK_WINDOW,
            user: ZERO_ADDRESS,
            is_frozen: false, 
            frozen_index: 0u32, 
            previous_root: 0field,
            new_root: 0field,
            role: 0u16,
            blocks: blocks,
            salt: multisig_common_params.salt
        };
        let signing_op_id = BHP256::hash_to_field(multisig_op);
        let wallet_signing_op_id_hash = multisig_core.aleo/get_signing_op_id_hash_fn(multisig_common_params.wallet_id, signing_op_id);

        return f_update_block_height_window(blocks, self.caller, wallet_signing_op_id_hash, multisig_op, multisig_common_params.wallet_id);
    }
    async function f_update_block_height_window(
        blocks: u32, 
        caller: address, 
        wallet_signing_op_id_hash: field,
        multisig_op: FreezeRegistryMultisigOp,
        wallet_id: address
    ) {
        if (wallet_id != ZERO_ADDRESS) {
            let wallet_id_role = wallet_id_to_role.get(wallet_id);
            assert(wallet_id_role & FREEZELIST_MANAGER_ROLE == FREEZELIST_MANAGER_ROLE);
            let signing_complete = multisig_core.aleo/completed_signing_ops.contains(wallet_signing_op_id_hash);
            assert(signing_complete);
            let pending_signing_op = multisig_core.aleo/pending_signing_ops.get(wallet_signing_op_id_hash);
            assert(pending_signing_op.expires_at_block > block.height);
            let pending_request = pending_requests.get(wallet_signing_op_id_hash);
            assert_eq(pending_request, multisig_op);
            pending_requests.remove(wallet_signing_op_id_hash);
        } else {
            assert_eq(multisig_op.salt, 0scalar);
            let role: u16 = address_to_role.get(caller);
            assert(role & FREEZELIST_MANAGER_ROLE == FREEZELIST_MANAGER_ROLE);
        }

        block_height_window.set(BLOCK_HEIGHT_WINDOW_INDEX, blocks);
    }

    // Freezes or unfreezes an account based on the is_frozen flag (true = freeze, false = unfreeze).
    // Can only be called after the contract has been initialized.
    // Verifies that the operation is valid:
    // - Cannot freeze an already frozen account or unfreeze an account that isn't frozen.
    // - When freezing:
    //   - Ensures the target index in freeze_list_index is empty.
    //   - Ensures the index is not greater than the last index + 1.
    //   - If the index equals last index + 1, updates freeze_list_last_index.
    // - When unfreezing:
    //   - Ensures the specified index currently holds the account being removed.
    // Requires the previous_root to prevent the admin from unintentionally overwriting updates.
    // Updates both the freeze_list and freeze_list_index mappings accordingly.
    // Also updates the current Merkle root and stores the previous root for backward compatibility.
    // Generates wallet_signing_op_id_hash using the parameters
    // Can be executed directly by an address with the freeze list manager role,
    // or by any caller if the corresponding multisig update freeze list manager request was approved and it is not expired.
    async transition update_freeze_list(
        public account: address, 
        public is_frozen: bool, 
        public frozen_index: u32, 
        public previous_root: field,
        public new_root: field,
        public multisig_common_params: MultisigCommonParams
    ) -> Future {
        let multisig_op: FreezeRegistryMultisigOp = FreezeRegistryMultisigOp {
            op: MULTISIG_OP_UPDATE_FREEZE_LIST,
            user: account,
            is_frozen: is_frozen, 
            frozen_index: frozen_index, 
            previous_root: previous_root,
            new_root: new_root,
            role: 0u16,
            blocks: 0u32,
            salt: multisig_common_params.salt
        };
        let signing_op_id = BHP256::hash_to_field(multisig_op);
        let wallet_signing_op_id_hash = multisig_core.aleo/get_signing_op_id_hash_fn(multisig_common_params.wallet_id, signing_op_id);

        return f_update_freeze_list(account, is_frozen, frozen_index, self.caller, previous_root, new_root, wallet_signing_op_id_hash, multisig_op, multisig_common_params.wallet_id);
    }
    async function f_update_freeze_list(
        account: address, 
        is_frozen: bool, 
        frozen_index: u32, 
        caller: address, 
        previous_root: field, 
        new_root: field,
        wallet_signing_op_id_hash: field,
        multisig_op: FreezeRegistryMultisigOp,
        wallet_id: address
    ) {
        if (wallet_id != ZERO_ADDRESS) {
            let wallet_id_role = wallet_id_to_role.get(wallet_id);
            assert(wallet_id_role & FREEZELIST_MANAGER_ROLE == FREEZELIST_MANAGER_ROLE);
            let signing_complete = multisig_core.aleo/completed_signing_ops.contains(wallet_signing_op_id_hash);
            assert(signing_complete);
            let pending_signing_op = multisig_core.aleo/pending_signing_ops.get(wallet_signing_op_id_hash);
            assert(pending_signing_op.expires_at_block > block.height);
            let pending_request = pending_requests.get(wallet_signing_op_id_hash);
            assert_eq(pending_request, multisig_op);        
            pending_requests.remove(wallet_signing_op_id_hash);
        } else {
            assert_eq(multisig_op.salt, 0scalar);
            let role: u16 = address_to_role.get(caller);
            assert(role & FREEZELIST_MANAGER_ROLE == FREEZELIST_MANAGER_ROLE);
        }

        let old_root: field = freeze_list_root.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
        assert_eq(previous_root, old_root);
        freeze_list_root.set(PREVIOUS_FREEZE_LIST_ROOT_INDEX, old_root);
        freeze_list_root.set(CURRENT_FREEZE_LIST_ROOT_INDEX, new_root);

        // Verify we don't unfreeze an unfrozen account or freeze a frozen account
        let stored_is_frozen = freeze_list.get_or_use(account, false);
        assert_neq(is_frozen, stored_is_frozen);
        freeze_list.set(account, is_frozen);

        let current_address_at_index: address = freeze_list_index.get_or_use(frozen_index, ZERO_ADDRESS);
        if (is_frozen) {
            // Verify that the frozen_index is empty.
            assert_eq(current_address_at_index, ZERO_ADDRESS);
            
            // Verify that the frozen index equal or smaller than the last index plus 1
            let last_index: u32 = freeze_list_last_index.get(FREEZE_LIST_LAST_INDEX);
            assert(last_index + 1u32 >= frozen_index);
        
            // Update the freeze_list_last_index
            if (last_index < frozen_index) {
                freeze_list_last_index.set(FREEZE_LIST_LAST_INDEX, frozen_index);
            }

            freeze_list_index.set(frozen_index, account);
        } else {
            // Verify that we update the correct frozen_index
            assert_eq(current_address_at_index, account);
            freeze_list_index.set(frozen_index, ZERO_ADDRESS);
        }

        root_updated_height.set(ROOT_UPDATED_HEIGHT_INDEX, block.height);
    }

    // Verifies that an account is not currently frozen.
    // Reads from the freeze_list mapping and asserts that the account is not marked as frozen.
    // This transition reveals the account address publicly.
    async transition verify_non_inclusion_pub(public account: address) -> Future {
        return f_verify_non_inclusion_pub(account);
    }
    async function f_verify_non_inclusion_pub(account: address) {
        let is_frozen: bool = freeze_list.get_or_use(account, false);
        assert_eq(is_frozen, false);
    }

    // Verifies that an account is not included in the freeze list Merkle tree.
    // Accepts a non-inclusion proof and checks the resulting root against the current or previous stored root:
    // - If the root matches the current root: the proof is accepted.
    // - If the root matches the previous root: ensures it was updated recently (within the allowed block window).
    // - If the root matches neither: the proof is rejected (invalid).
    // Keeps the account address private.
    async transition verify_non_inclusion_priv(account: address, merkle_proof: [MerkleProof; 2]) -> Future {
        let root: field = merkle_tree.aleo/verify_non_inclusion(account, merkle_proof);
        return f_verify_non_inclusion_priv(root);
    }
    async function f_verify_non_inclusion_priv(root: field) {
        let current_root: field = freeze_list_root.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
        if (current_root != root) {
            let previous_root: field = freeze_list_root.get(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
            assert_eq(root, previous_root);
            let window: u32 = block_height_window.get(BLOCK_HEIGHT_WINDOW_INDEX);
            let updated_height: u32 = root_updated_height.get(ROOT_UPDATED_HEIGHT_INDEX);
            assert(updated_height + window > block.height);
        }
    }
}