
import merkle_tree.aleo;
import multisig.aleo;

program sealance_freezelist_registry.aleo {
    @custom
    async constructor() {
        if(UPGRADE_ADDRESS != self.program_owner) {
            let approved_checksum = approved_upgrades.get(self.edition);
            assert_eq(approved_checksum, self.checksum);
        }
    }
    
    const ZERO_ADDRESS: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc; // ZERO_ADDRESS as field equals to 0field
    const EMPTY_ROOT: field = 3642222252059314292809609689035560016959342421640560347114299934615987159853field; // hash of H(ZERO_ADDRESS, ZERO_ADDRESS)
    // Only this address can initialize the program
    const INITIAL_CONFIGURATION_ADDRESS: address = aleo1mh7al4qsedqvsh64pmmlcmzl5ugmrdxp4a4rdneja7etn8cpuspqvrj9q8;

    // Only this address can upgrade the program
    const UPGRADE_ADDRESS: address = aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px;

    // Roles can be assigned using bitmasking to allow multiple roles per address
    const NONE_ROLE: u16 = 0u16;
    const MANAGER_ROLE: u16 = 8u16; // can only assign roles
    const FREEZELIST_MANAGER_ROLE: u16 = 16u16; // can update the freeze list
    mapping address_to_role: address => u16;

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

    const WALLET_ID: address = aleo12ux3gdauck0v60westgcpqj7v8rrcr3v346e4jtq04q7kkt22czsh808v2;

    const MULTISIG_OP_UPGRADE: u8 = 1u8;
    const MULTISIG_OP_UPDATE_ROLE: u8 = 2u8;
    const MULTISIG_OP_UPDATE_FREEZE_LIST: u8 = 3u8;

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

        // Only used for MULTISIG_OP_UPGRADE
        edition: u16,
        checksum: [u8; 32]
    }
    // Stores pending multisig requests, Keyed by hash(WalletSigningOpId) to uniquely identify each operation
    mapping pending_requests: field => FreezeRegistryMultisigOp; // hash(WalletSigningOpId) => FreezeRegistryMultisigOp;
    // Stores checksums of approved upgrades by edition, upgrades are allowed if the provided checksum matches the stored value for that edition.
    mapping approved_upgrades: u16 => [u8; 32]; // edition => checksum;

    // -------------------------
    // Called by multisig signer
    // -------------------------

    // Initializes a new multisig operation.
    // Can only be called by a wallet signer.
    // Registers the operation with the external multisig wallet using its signing_op_id.
    // Stores the associated FreezeRegistryMultisigOp under the hashed wallet operation ID.
    // Fails if an operation with the same ID already exists.
    async transition init_multisig_op(signing_op_id: field, multisig_op: FreezeRegistryMultisigOp) -> (field, Future) {
        let (wallet_signing_op_id_hash, init_signing_op_fut) = multisig.aleo/initiate_signing_op(WALLET_ID, signing_op_id);
        return (wallet_signing_op_id_hash, fin_init_multisig_op(
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
        assert(!pending_requests.contains(wallet_signing_op_id_hash));
        pending_requests.set(wallet_signing_op_id_hash, multisig_op);
        init_signing_op_fut.await();
    }

    // Executes a previously initialized multisig operation after enough required signatures are collected.
    // Verifies that signing is complete and the operation details match the original request.
    // Supports the following operations:
    // - Approve upgrade: adds a checksum to the approved_upgrades mapping for a given edition. 
    // This does not perform the upgrade itself — it only enables a future upgrade to proceed if the edition and checksum match.
    // - Role updates
    // - Update the freeze list
    // Removes the operation from pending_requests to prevent replay.
    async transition exec_multisig_op(signing_op_id: field, multisig_op: FreezeRegistryMultisigOp) -> Future {
        let signing_complete_fut = multisig.aleo/assert_signing_completed(WALLET_ID, signing_op_id);
        let wallet_signing_op_id_hash = multisig.aleo/get_signing_op_id_hash_fn(WALLET_ID, signing_op_id);

        return fin_exec_multisig_op(wallet_signing_op_id_hash, multisig_op, signing_complete_fut);
    }
    async function fin_exec_multisig_op(
        wallet_signing_op_id_hash: field,
        multisig_op: FreezeRegistryMultisigOp,
        signing_complete_fut: Future,
    ) {
        // Signing must be completed.
        signing_complete_fut.await();

        // Details must match!
        let pending_request = pending_requests.get(wallet_signing_op_id_hash);
        assert_eq(pending_request, multisig_op);

        // Execute request
        if (multisig_op.op == MULTISIG_OP_UPGRADE) {
            approved_upgrades.set(multisig_op.edition, multisig_op.checksum);
        }
        else if (multisig_op.op == MULTISIG_OP_UPDATE_ROLE) {
            address_to_role.set(multisig_op.user, multisig_op.role);
        } else if (multisig_op.op == MULTISIG_OP_UPDATE_FREEZE_LIST) {
            let old_root: field = freeze_list_root.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
            assert_eq(multisig_op.previous_root, old_root);
            freeze_list_root.set(PREVIOUS_FREEZE_LIST_ROOT_INDEX, old_root);
            freeze_list_root.set(CURRENT_FREEZE_LIST_ROOT_INDEX, multisig_op.new_root);

            // Verify we don't unfreeze an unfrozen account or freeze a frozen account
            let stored_is_frozen = freeze_list.get_or_use(multisig_op.user, false);
            assert_neq(multisig_op.is_frozen, stored_is_frozen);
            freeze_list.set(multisig_op.user, multisig_op.is_frozen);

            let current_address_at_index: address = freeze_list_index.get_or_use(multisig_op.frozen_index, ZERO_ADDRESS);
            if (multisig_op.is_frozen) {
                // Verify that the frozen_index is empty.
                assert_eq(current_address_at_index, ZERO_ADDRESS);
                
                // Verify that the frozen index equal or smaller than the last index plus 1
                let last_index: u32 = freeze_list_last_index.get(FREEZE_LIST_LAST_INDEX);
                assert(last_index + 1u32 >= multisig_op.frozen_index);
            
                // Update the freeze_list_last_index
                if (last_index < multisig_op.frozen_index) {
                    freeze_list_last_index.set(FREEZE_LIST_LAST_INDEX, multisig_op.frozen_index);
                }

                freeze_list_index.set(multisig_op.frozen_index, multisig_op.user);
            } else {
                // Verify that we update the correct frozen_index
                assert_eq(current_address_at_index, multisig_op.user);
                freeze_list_index.set(multisig_op.frozen_index, ZERO_ADDRESS);
            }

            root_updated_height.set(ROOT_UPDATED_HEIGHT_INDEX, block.height);
        } else {
            assert(false);
        }

        // Removing is crucial, otherwise the operation can be executed twice.
        pending_requests.remove(wallet_signing_op_id_hash);
    }

    // Initializes the freeze list and the admin.
    // Can only be called once — ensures the contract has not already been initialized.
    // Can be called only by the INITIAL_ADMIN
    // Sets the block height window, the initial empty Merkle root,
    // and initialize the freeze_list_last_index, freeze_list, and freeze_list_index with a ZERO_ADDRESS placeholder.
    async transition initialize(public admin: address, public blocks: u32) -> Future {
        return f_initialize(admin, self.caller, blocks);
    }
    async function f_initialize(admin: address, caller: address, blocks: u32) {
        let is_already_initialized: bool = freeze_list_root.contains(CURRENT_FREEZE_LIST_ROOT_INDEX);
        assert_eq(is_already_initialized, false);

        assert_eq(caller, INITIAL_CONFIGURATION_ADDRESS);
        address_to_role.set(admin, MANAGER_ROLE);

        block_height_window.set(BLOCK_HEIGHT_WINDOW_INDEX, blocks);
        freeze_list_last_index.set(FREEZE_LIST_LAST_INDEX, 0u32);
        freeze_list_root.set(CURRENT_FREEZE_LIST_ROOT_INDEX,EMPTY_ROOT);
        freeze_list.set(ZERO_ADDRESS, false);
        freeze_list_index.set(0u32, ZERO_ADDRESS);
    }

    // Updates the address assigned to a given role.
    // Can only be called by the current role manager.
    // Ensures the caller retains manager privileges, preventing a state with no active managers.
    async transition update_role(public new_address: address, role: u16) -> Future {
        return f_update_role(new_address, self.caller, role);
    }
    async function f_update_role(new_address: address, caller: address, new_role: u16) {
        let current_role: u16 = address_to_role.get(caller);
        assert(current_role & MANAGER_ROLE == MANAGER_ROLE);

        if (caller == new_address) {
            assert(new_role & MANAGER_ROLE == MANAGER_ROLE); 
        }
        
        address_to_role.set(new_address, new_role);
    }

    // Updates the number of blocks during which the previous root is still considered valid.
    // Can only be called by the admin.
    async transition update_block_height_window(public blocks: u32) -> Future {
        return f_update_block_height_window(blocks, self.caller);
    }
    async function f_update_block_height_window(blocks: u32, caller: address) {
        let role: u16 = address_to_role.get(caller);
        assert(role & FREEZELIST_MANAGER_ROLE == FREEZELIST_MANAGER_ROLE);

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
    // Can only be called by the admin and the freeze list manager.
    async transition update_freeze_list(
        public account: address, 
        public is_frozen: bool, 
        public frozen_index: u32, 
        public previous_root: field,
        public new_root: field
    ) -> Future {
        return f_update_freeze_list(account, is_frozen, frozen_index, self.caller, previous_root, new_root);
    }
    async function f_update_freeze_list(account: address, is_frozen: bool, frozen_index: u32, caller: address, previous_root: field, new_root: field) {
        let role: u16 = address_to_role.get(caller);
        assert(role & FREEZELIST_MANAGER_ROLE == FREEZELIST_MANAGER_ROLE);

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