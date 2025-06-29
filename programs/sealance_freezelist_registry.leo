
import merkle_tree.aleo;

program sealance_freezelist_registry.aleo {
    const ZERO_ADDRESS: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc; // ZERO_ADDRESS as field equals to 0field

    const ADMIN_INDEX: u8 = 1u8;
    const CURRENT_FREEZE_LIST_ROOT_INDEX: u8 = 1u8;
    const PREVIOUS_FREEZE_LIST_ROOT_INDEX: u8 = 2u8;
    const ROOT_UPDATED_HEIGHT_INDEX: bool = true;
    const BLOCK_HEIGHT_WINDOW_INDEX: bool = true;

    // Indicates whether an address is frozen.
    mapping freeze_list: address => bool;
    // Mimics an array of frozen addresses by storing them at sequential indexes.
    mapping freeze_list_index: u32 => address;
    // Stores the current and previous Merkle roots of the freeze list (e.g., 1 = current, 2 = previous).
    mapping freeze_list_root: u8 => field;
    // Stores the block height when the root was updated.
    mapping root_updated_height: bool => u32;
    // Defines the number of blocks during which the previous root is still considered valid.
    mapping block_height_window: bool => u32;
    // Maps a role ID to an address (e.g., 1 = admin).
    mapping roles: u8 => address;

    struct MerkleProof {
        siblings: [field; 16],
        leaf_index: u32
    }

    // Updates the address assigned to a given role.
    // Can only be called by the admin.
    // If no admin is set yet, the caller is temporarily treated as admin.
    async transition update_role(public new_admin_address: address, role: u8) -> Future {
        return f_update_role(new_admin_address, self.caller, role);
    }
    async function f_update_role(new_admin_address: address, caller: address, role: u8) {
        let admin_address: address = roles.get_or_use(ADMIN_INDEX, caller);
        assert_eq(admin_address, caller);
        roles.set(role, new_admin_address);
    }

    // Updates the number of blocks during which the previous root is still considered valid.
    // Can only be called by the admin.
    async transition update_block_height_window(public blocks: u32) -> Future {
        return f_update_block_height_window(blocks, self.caller);
    }
    async function f_update_block_height_window(blocks: u32, caller: address) {
        let admin_address: address = roles.get(ADMIN_INDEX);
        assert_eq(admin_address, caller);

        block_height_window.set(BLOCK_HEIGHT_WINDOW_INDEX, blocks);
    }

    // Freezes or unfreezes an account based on the is_freezed flag (true = freeze, false = unfreeze).
    // Updates both the freeze_list and freeze_list_index mappings accordingly.
    // Also updates the current Merkle root and stores the previous root for backward compatibility.
    // Can only be called by the admin.
    async transition update_freeze_list(public account: address, public is_freezed: bool, public freezed_index: u32, public new_root: field) -> Future {
        return f_update_freeze_list(account, is_freezed, freezed_index, self.caller, new_root);
    }
    async function f_update_freeze_list(account: address, is_freezed: bool, freezed_index: u32, caller: address, new_root: field) {
        let admin_address: address = roles.get(ADMIN_INDEX);
        assert_eq(admin_address, caller);

        let old_root: field = freeze_list_root.get_or_use(CURRENT_FREEZE_LIST_ROOT_INDEX, 0field);
        freeze_list_root.set(PREVIOUS_FREEZE_LIST_ROOT_INDEX, old_root);
        freeze_list_root.set(CURRENT_FREEZE_LIST_ROOT_INDEX, new_root);

        freeze_list.set(account, is_freezed);
        freeze_list_index.set(freezed_index, is_freezed ? account : ZERO_ADDRESS);

        root_updated_height.set(ROOT_UPDATED_HEIGHT_INDEX, block.height);
    }

    // Verifies that an account is not currently frozen.
    // Reads from the freeze_list mapping and asserts that the account is not marked as frozen.
    // This transition reveals the account address publicly.
    async transition verify_non_inclusion_pub(public account: address) -> Future {
        return f_verify_non_inclusion_pub(account);
    }
    async function f_verify_non_inclusion_pub(account: address) {
        let is_freezed: bool = freeze_list.get_or_use(account, false);
        assert_eq(is_freezed, false);
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
            let window: u32 = block_height_window.get_or_use(BLOCK_HEIGHT_WINDOW_INDEX, 0u32);
            let updated_height: u32 = root_updated_height.get(ROOT_UPDATED_HEIGHT_INDEX);
            assert(updated_height + window > block.height);
        }
    }
}