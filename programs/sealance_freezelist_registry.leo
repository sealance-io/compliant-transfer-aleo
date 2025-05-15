
import merkle_tree.aleo;

program sealance_freezelist_registry.aleo {
    const ZERO_ADDRESS: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc; // ZERO_ADDRESS as field equals to 0field

    struct MerkleProof {
        siblings: [field; 16],
        leaf_index: u32
    }

    mapping freeze_list: address => bool; // Indicates if address is frozen
    mapping freeze_list_index: u32 => address; // Mimic an array of all the frozen addresses
    mapping freeze_list_root: u8 => field;
    mapping root_updated_height: u8 => u32;
    mapping block_height_window: u8 => u32; // it defines a window of blocks within which the old root is considered valid
    mapping admin: u8 => address;

    async transition update_admin_address(public new_admin_address: address) -> Future {
        return f_update_admin_address(new_admin_address, self.caller);
    }
    async function f_update_admin_address(new_admin_address: address, caller: address) {
        let admin_address: address = admin.get_or_use(0u8, caller);
        assert_eq(admin_address, caller);
        admin.set(0u8, new_admin_address);
    }

    async transition update_block_height_window(public blocks: u32) -> Future {
        return f_update_block_height_window(blocks, self.caller);
    }
    async function f_update_block_height_window(blocks: u32, caller: address) {
        let admin_address: address = admin.get(0u8);
        assert_eq(admin_address, caller);

        block_height_window.set(0u8, blocks);
    }

    async transition update_freeze_list(public account: address, public is_freezed: bool, public freezed_index: u32, public new_root: field) -> Future {
        return f_update_freeze_list(account, is_freezed, freezed_index, self.caller, new_root);
    }
    async function f_update_freeze_list(account: address, is_freezed: bool, freezed_index: u32, caller: address, new_root: field) {
        let admin_address: address = admin.get(0u8);
        assert_eq(admin_address, caller);

        let old_root: field = freeze_list_root.get_or_use(0u8, 0field);
        freeze_list_root.set(1u8, old_root);
        freeze_list_root.set(0u8, new_root);

        freeze_list.set(account, is_freezed);
        freeze_list_index.set(freezed_index, is_freezed ? account : ZERO_ADDRESS);

        root_updated_height.set(0u8, block.height);
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
        let current_root: field = freeze_list_root.get(0u8);
        if(current_root == root) {
            assert_eq(root, current_root);
        } else {
            let previous_root: field = freeze_list_root.get(1u8);
            assert_eq(root, previous_root);
            let window: u32 = block_height_window.get_or_use(0u8, 0u32);
            window = block.height > window 
                ? window
                : block.height;
            let updated_height: u32 = root_updated_height.get(0u8);
            assert(updated_height > (block.height - window));
        }
    }
}