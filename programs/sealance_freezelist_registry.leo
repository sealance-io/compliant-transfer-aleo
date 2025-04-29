
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

    mapping admin: u8 => address;

    async transition update_admin_address(public new_admin_address: address) -> Future {
        return f_update_admin_address(new_admin_address, self.caller);
    }
    async function f_update_admin_address(new_admin_address: address, caller: address) {
        let admin_address: address = admin.get_or_use(0u8, caller);
        assert_eq(admin_address, caller);
        admin.set(0u8, new_admin_address);
    }

    async transition update_freeze_list(public account: address, public is_freezed: bool, public freezed_index: u32, public new_root: field) -> Future {
        return f_update_freeze_list(account, is_freezed, freezed_index, self.caller, new_root);
    }
    async function f_update_freeze_list(account: address, is_freezed: bool, freezed_index: u32, caller: address, new_root: field) {
        let admin_address: address = admin.get(0u8);
        assert_eq(admin_address, caller);

        freeze_list.set(account, is_freezed);
        freeze_list_index.set(freezed_index, is_freezed ? account : ZERO_ADDRESS);
        freeze_list_root.set(0u8, new_root);
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
        assert_eq(current_root, root);
    }
}