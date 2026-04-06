
import sealance_freezelist_registry.aleo;
import multisig_core.aleo;

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

program multisig_freezelist_proxy.aleo {
    @custom
    constructor() {
        // Only require multisig for upgrades - initial deployment has no checks.
        if self.edition > 0u16 {
            let signing_op_id = BHP256::hash_to_field(ChecksumEdition { checksum: self.checksum, edition: self.edition });

            let wallet_signing_op_id_hash = BHP256::hash_to_field(multisig_core.aleo::WalletSigningOpId { wallet_id: self.address, signing_op_id: signing_op_id });
            let signing_complete = multisig_core.aleo::completed_signing_ops.contains(wallet_signing_op_id_hash);
            assert(signing_complete);
        }
    }

    const ZERO_ADDRESS: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc; // ZERO_ADDRESS as field equals to 0field
    // Only this address can initialize the program
    const INITIAL_CONFIGURATION_ADDRESS: address = aleo1mh7al4qsedqvsh64pmmlcmzl5ugmrdxp4a4rdneja7etn8cpuspqvrj9q8;

    // Roles can be assigned using bitmasking to allow multiple roles per address
    const NONE_ROLE: u16 = 0u16;
    const MANAGER_ROLE: u16 = 8u16; // can only assign roles
    const FREEZELIST_MANAGER_ROLE: u16 = 16u16; // can update the freeze list
    // Maps each multisig wallet ID to its assigned role,
    // defining what actions that multisig wallet is authorized to perform.
    mapping wallet_id_to_role: address => u16;

    const INITIALIZED_INDEX: bool = true;
    // Indicates whether an address is frozen.
    mapping initialized: bool => bool;

    const MULTISIG_OP_UPDATE_WALLET_ROLE: u8 = 1u8;
    const MULTISIG_OP_UPDATE_ROLE: u8 = 2u8;
    const MULTISIG_OP_UPDATE_BLOCK_WINDOW: u8 = 3u8;
    const MULTISIG_OP_UPDATE_FREEZE_LIST: u8 = 4u8;

    // Stores pending multisig requests, Keyed by hash(multisig_core.aleo::WalletSigningOpId) to uniquely identify each operation
    mapping pending_requests: field => FreezeRegistryMultisigOp; // hash(multisig_core.aleo::WalletSigningOpId) => FreezeRegistryMultisigOp;

    // A helper for calculating a signing_op_id from the program's checksum and edition.
    // By deriving the signing_op_id from both we ensure that downgrades cannot take place.
    fn get_signing_op_id_for_deploy(checksum: [u8; 32], edition: u16) -> field {
        return BHP256::hash_to_field(ChecksumEdition { checksum: checksum, edition: edition });
    }

    // Initializes a new multisig operation.
    // Computes the signing_op_id, registers it with the external multisig wallet,
    // and stores the FreezeRegistryMultisigOp under the hashed wallet operation ID.
    // Fails if an operation with the same ID already exists unless this request is expired.
    // Can only be called after the token has been initialized.
    fn init_multisig_op(wallet_id: address, multisig_op: FreezeRegistryMultisigOp, public block_expiration: u32) -> (field, field, Final) {
        let signing_op_id = BHP256::hash_to_field(multisig_op);
        let (wallet_signing_op_id_hash, init_signing_op_fut) = multisig_core.aleo::initiate_signing_op(wallet_id, signing_op_id, block_expiration);
        return (signing_op_id, wallet_signing_op_id_hash, final {
            let is_already_initialized: bool = initialized.get_or_use(INITIALIZED_INDEX, false);
            assert_eq(is_already_initialized, true);

            let already_requested: bool = pending_requests.contains(wallet_signing_op_id_hash);
            if (already_requested) {
                let existing_pending_op = multisig_core.aleo::pending_signing_ops.get(wallet_signing_op_id_hash);
                assert(existing_pending_op.expires_at_block < block.height);
            }

            pending_requests.set(wallet_signing_op_id_hash, multisig_op);
            init_signing_op_fut.run();
        });
    }

    // Initializes the freeze list and the admin.
    // Can only be called once -- ensures the contract has not already been initialized.
    // Can be called only by the INITIAL_CONFIGURATION_ADDRESS
    // Sets the block height window, the initial empty Merkle root,
    // and initialize the freeze_list_last_index, freeze_list, and freeze_list_index with a ZERO_ADDRESS placeholder.
    fn initialize(public manager_wallet_id: address) -> Final {
        let caller: address = self.caller;
        return final {
            assert_eq(caller, INITIAL_CONFIGURATION_ADDRESS);

            let is_already_initialized: bool = initialized.get_or_use(INITIALIZED_INDEX, false);
            assert_eq(is_already_initialized, false);

            initialized.set(INITIALIZED_INDEX, true);

            assert_neq(manager_wallet_id, ZERO_ADDRESS);
            wallet_id_to_role.set(manager_wallet_id, MANAGER_ROLE);
        };
    }

    // Updates the wallet_id assigned to a given role.
    // Generates wallet_signing_op_id_hash using the parameters
    // Can be executed directly by an address with the manager role,
    // or by any caller if the corresponding multisig update wallet id request was approved and it is not expired.
    fn update_wallet_id_role(public target_wallet_id: address, public role: u16, public multisig_common_params: MultisigCommonParams) -> Final {
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
        let wallet_signing_op_id_hash = multisig_core.aleo::get_signing_op_id_hash_fn(multisig_common_params.wallet_id, signing_op_id);

        return final {
            let wallet_id_role = wallet_id_to_role.get(multisig_common_params.wallet_id);
            assert(wallet_id_role & MANAGER_ROLE == MANAGER_ROLE);
            let signing_complete = multisig_core.aleo::completed_signing_ops.contains(wallet_signing_op_id_hash);
            assert(signing_complete);
            let pending_signing_op = multisig_core.aleo::pending_signing_ops.get(wallet_signing_op_id_hash);
            assert(pending_signing_op.expires_at_block > block.height);
            let pending_request = pending_requests.get(wallet_signing_op_id_hash);
            assert_eq(pending_request, multisig_op);
            pending_requests.remove(wallet_signing_op_id_hash);
            if (multisig_common_params.wallet_id == target_wallet_id) {
                assert(role & MANAGER_ROLE == MANAGER_ROLE);
            }

            wallet_id_to_role.set(target_wallet_id, role);
        };
    }

    // Updates the address assigned to a given role.
    // Generates wallet_signing_op_id_hash using the parameters
    // Can be executed directly by an address with the manager role,
    // or by any caller if the corresponding multisig update role request was approved and it is not expired.
    // Ensures the caller retains manager privileges, preventing a state with no active managers.
    fn update_role(public new_address: address, public role: u16, public multisig_common_params: MultisigCommonParams) -> Final {
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
        let wallet_signing_op_id_hash = multisig_core.aleo::get_signing_op_id_hash_fn(multisig_common_params.wallet_id, signing_op_id);

        let freezelist_registry_call: Final = sealance_freezelist_registry.aleo::update_role(new_address, role);

        return final {
            let wallet_id_role = wallet_id_to_role.get(multisig_common_params.wallet_id);
            assert(wallet_id_role & MANAGER_ROLE == MANAGER_ROLE);
            let signing_complete = multisig_core.aleo::completed_signing_ops.contains(wallet_signing_op_id_hash);
            assert(signing_complete);
            let pending_signing_op = multisig_core.aleo::pending_signing_ops.get(wallet_signing_op_id_hash);
            assert(pending_signing_op.expires_at_block > block.height);
            let pending_request = pending_requests.get(wallet_signing_op_id_hash);
            assert_eq(pending_request, multisig_op);
            pending_requests.remove(wallet_signing_op_id_hash);

            freezelist_registry_call.run();
        };
    }

    // Updates the number of blocks during which the previous root is still considered valid.
    // Generates wallet_signing_op_id_hash using the parameters
    // Can be executed directly by an address with the freeze list manager role,
    // or by any caller if the corresponding multisig update block height window request was approved  and it is not expired..
    fn update_block_height_window(public blocks: u32, public multisig_common_params: MultisigCommonParams) -> Final {
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
        let wallet_signing_op_id_hash = multisig_core.aleo::get_signing_op_id_hash_fn(multisig_common_params.wallet_id, signing_op_id);

        let freezelist_registry_call: Final = sealance_freezelist_registry.aleo::update_block_height_window(blocks);

        return final {
            let wallet_id_role = wallet_id_to_role.get(multisig_common_params.wallet_id);
            assert(wallet_id_role & FREEZELIST_MANAGER_ROLE == FREEZELIST_MANAGER_ROLE);
            let signing_complete = multisig_core.aleo::completed_signing_ops.contains(wallet_signing_op_id_hash);
            assert(signing_complete);
            let pending_signing_op = multisig_core.aleo::pending_signing_ops.get(wallet_signing_op_id_hash);
            assert(pending_signing_op.expires_at_block > block.height);
            let pending_request = pending_requests.get(wallet_signing_op_id_hash);
            assert_eq(pending_request, multisig_op);
            pending_requests.remove(wallet_signing_op_id_hash);

            freezelist_registry_call.run();
        };
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
    fn update_freeze_list(
        public account: address,
        public is_frozen: bool,
        public frozen_index: u32,
        public previous_root: field,
        public new_root: field,
        public multisig_common_params: MultisigCommonParams
    ) -> Final {
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
        let wallet_signing_op_id_hash = multisig_core.aleo::get_signing_op_id_hash_fn(multisig_common_params.wallet_id, signing_op_id);

        let freezelist_registry_call: Final = sealance_freezelist_registry.aleo::update_freeze_list(
            account,
            is_frozen,
            frozen_index,
            previous_root,
            new_root,
        );

        return final {
            let wallet_id_role = wallet_id_to_role.get(multisig_common_params.wallet_id);
            assert(wallet_id_role & FREEZELIST_MANAGER_ROLE == FREEZELIST_MANAGER_ROLE);
            let signing_complete = multisig_core.aleo::completed_signing_ops.contains(wallet_signing_op_id_hash);
            assert(signing_complete);
            let pending_signing_op = multisig_core.aleo::pending_signing_ops.get(wallet_signing_op_id_hash);
            assert(pending_signing_op.expires_at_block > block.height);
            let pending_request = pending_requests.get(wallet_signing_op_id_hash);
            assert_eq(pending_request, multisig_op);
            pending_requests.remove(wallet_signing_op_id_hash);

            freezelist_registry_call.run();
        };
    }
}
