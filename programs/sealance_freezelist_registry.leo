
import merkle_tree.aleo;

program sealance_freezelist_registry.aleo {
    const ZERO_ADDRESS: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc; // ZERO_ADDRESS as field equals to 0field

    const ADMIN_INDEX: u8 = 1u8;
    const CURRENT_FREEZE_LIST_ROOT_INDEX: u8 = 1u8;
    const PREVIOUS_FREEZE_LIST_ROOT_INDEX: u8 = 2u8;
    const ROOT_UPDATED_HEIGHT_INDEX: bool = true;
    const BLOCK_HEIGHT_WINDOW_INDEX: bool = true;

    struct MerkleProof {
        siblings: [field; 16],
        leaf_index: u32
    }

    mapping freeze_list: address => bool; // Indicates if address is frozen
    mapping freeze_list_index: u32 => address; // Mimic an array of all the frozen addresses
    mapping freeze_list_root: u8 => field;
    mapping root_updated_height: bool => u32;
    mapping block_height_window: bool => u32; // it defines a window of blocks within which the old root is considered valid
    mapping roles: u8 => address;

    async transition update_role(public new_admin_address: address, role: u8) -> Future {
        return f_update_role(new_admin_address, self.caller, role);
    }
    async function f_update_role(new_admin_address: address, caller: address, role: u8) {
        let admin_address: address = roles.get_or_use(ADMIN_INDEX, caller);
        assert_eq(admin_address, caller);
        roles.set(role, new_admin_address);
    }

    async transition update_block_height_window(public blocks: u32) -> Future {
        return f_update_block_height_window(blocks, self.caller);
    }
    async function f_update_block_height_window(blocks: u32, caller: address) {
        let admin_address: address = roles.get(ADMIN_INDEX);
        assert_eq(admin_address, caller);

        block_height_window.set(BLOCK_HEIGHT_WINDOW_INDEX, blocks);
    }

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

    async transition verify_non_inclusion_pub(public account: address) -> Future {
        return f_verify_non_inclusion_pub(account);
    }
    async function f_verify_non_inclusion_pub(account: address) {
        let is_freezed: bool = freeze_list.get_or_use(account, false);
        assert_eq(is_freezed, false);
    }

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