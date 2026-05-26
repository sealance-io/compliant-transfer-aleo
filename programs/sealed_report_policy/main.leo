import token_registry.aleo;
import merkle_tree.aleo;
import multisig_core.aleo;

struct ChecksumEdition {
    checksum: [u8; 32],
    edition: u16,
}

program sealed_report_policy.aleo {
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

    const TOKEN_ID: field = 475390673649194485158084951104358477375241536345field; // SEALED_REPORT ascii encoded
    const ZERO_ADDRESS: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc; // ZERO_ADDRESS as field equals to 0field
    // Set to the maximum u32 to avoid expiration. However, the asset is always used immediately in the same transaction
    const AUTHORIZED_UNTIL: u32 = 4294967295u32;
    const EMPTY_ROOT: field = 3642222252059314292809609689035560016959342421640560347114299934615987159853field; // hash of H(ZERO_ADDRESS, ZERO_ADDRESS)
    // Only this address can initialize the program
    const INITIAL_CONFIGURATION_ADDRESS: address = aleo1mh7al4qsedqvsh64pmmlcmzl5ugmrdxp4a4rdneja7etn8cpuspqvrj9q8;
    // This address receives compliance records (can be updated with the contract upgrade)
    const INVESTIGATOR_ADDRESS: address = aleo12ux3gdauck0v60westgcpqj7v8rrcr3v346e4jtq04q7kkt22czsh808v2;

    // Freeze list manager: can update the freeze list
    const FREEZE_LIST_MANAGER_INDEX: u8 = 4u8;
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

    const NONE_ROLE: u16 = 0u16;
    const MANAGER_ROLE: u16 = 8u16; // can only assign roles
    const FREEZELIST_MANAGER_ROLE: u16 = 16u16; // can update the freeze list
    mapping address_to_role: address => u16;

    // Compliance record used for the investigator
    record ComplianceRecord {
        owner: address,
        amount: u128,
        sender: address,
        recipient: address
    }

    // Initializes the freeze list, and the admin.
    // Can only be called once — ensures the contract has not already been initialized.
    // Can be called only by the INITIAL_CONFIGURATION_ADDRESS
    // Sets the block height window, the initial empty Merkle root,
    // and initialize the freeze_list_last_index, freeze_list, and freeze_list_index with a ZERO_ADDRESS placeholder.
    fn initialize(public admin: address, public blocks: u32) -> Final {
        let caller: address = self.caller;
        return final {
            let is_already_initialized: bool = freeze_list_root.contains(CURRENT_FREEZE_LIST_ROOT_INDEX);
            assert_eq(is_already_initialized, false);

            assert_eq(caller, INITIAL_CONFIGURATION_ADDRESS);
            address_to_role.set(admin, MANAGER_ROLE);

            block_height_window.set(BLOCK_HEIGHT_WINDOW_INDEX, blocks);
            freeze_list_last_index.set(FREEZE_LIST_LAST_INDEX, 0u32);
            freeze_list_root.set(CURRENT_FREEZE_LIST_ROOT_INDEX,EMPTY_ROOT);
            freeze_list.set(ZERO_ADDRESS, false);
            freeze_list_index.set(0u32, ZERO_ADDRESS);
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
    // Can only be called by the freeze list manager.
    fn update_freeze_list(
        public account: address,
        public is_frozen: bool,
        public frozen_index: u32,
        public previous_root: field,
        public new_root: field
    ) -> Final {
        let caller: address = self.caller;
        return final {
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
        };
    }

    // Updates the address assigned to a given role.
    // Can only be called by the current role manager.
    fn update_role(public new_address: address, role: u16) -> Final {
        let caller: address = self.caller;
        return final {
            let current_role: u16 = address_to_role.get(caller);
            assert(current_role & MANAGER_ROLE == MANAGER_ROLE);

            if (caller == new_address) {
                assert(role & MANAGER_ROLE == MANAGER_ROLE);
            }

            address_to_role.set(new_address, role);
        };
    }

    // Updates the number of blocks during which the previous root is still considered valid.
    // Can only be called by the admin.
    fn update_block_height_window(public blocks: u32) -> Final {
        let caller: address = self.caller;
        return final {
            let role: u16 = address_to_role.get(caller);
            assert(role & FREEZELIST_MANAGER_ROLE == FREEZELIST_MANAGER_ROLE);

            block_height_window.set(BLOCK_HEIGHT_WINDOW_INDEX, blocks);
        };
    }

    // -------------------------
    // Called by token owners/DeFi contracts
    // -------------------------

    // Transfers public tokens from the caller to the recipient.
    // The caller must first approve this contract in the token_registry via the approve transition.
    // Both sender and recipient must not be frozen in the freeze list.
    fn transfer_public(
        public recipient: address,
        public amount: u128
    ) -> Final {
        let caller: address = self.caller;
        let owner: token_registry.aleo::TokenOwner = token_registry.aleo::TokenOwner {
            account: self.caller,
            token_id: TOKEN_ID
        };
        let authorization_call: Final = token_registry.aleo::prehook_public(
            owner,
            amount,
            AUTHORIZED_UNTIL
        );

        let transfer_call: Final = token_registry.aleo::transfer_from_public(
            TOKEN_ID,
            self.caller,
            recipient,
            amount
        );
        return final {
            let is_sender_frozen: bool = freeze_list.get_or_use(caller, false);
            assert_eq(is_sender_frozen, false);
            let is_recipient_frozen: bool = freeze_list.get_or_use(recipient, false);
            assert_eq(is_recipient_frozen, false);

            authorization_call.run();
            transfer_call.run();
        };
    }

    // Transfers public tokens from the signer to the recipient.
    // Both sender and recipient must not be frozen in the freeze list.
    fn transfer_public_as_signer(
        public recipient: address,
        public amount: u128
    ) -> Final {
        let signer: address = self.signer;
        let owner: token_registry.aleo::TokenOwner = token_registry.aleo::TokenOwner {
            account: self.signer,
            token_id: TOKEN_ID
        };

        let authorization_call: Final = token_registry.aleo::prehook_public(
            owner,
            amount,
            AUTHORIZED_UNTIL
        );

        let transfer_call: Final = token_registry.aleo::transfer_public_as_signer(
            TOKEN_ID,
            recipient,
            amount
        );
        return final {
            let is_sender_frozen: bool = freeze_list.get_or_use(signer, false);
            assert_eq(is_sender_frozen, false);
            let is_recipient_frozen: bool = freeze_list.get_or_use(recipient, false);
            assert_eq(is_recipient_frozen, false);

            authorization_call.run();
            transfer_call.run();
        };
    }

    // Transfers public tokens from the caller to a recipient as a private token.
    // The caller must first approve this contract in the token_registry via the approve transition.
    // A ComplianceRecord is emitted for the investigator, who must match the stored investigator role.
    // Both sender and recipient must not be frozen in the freeze list.
    // The recipient's privacy is preserved by proving non-inclusion in the freeze list Merkle tree.
    fn transfer_public_to_priv(
        recipient: address,
        public amount: u128,
        recipient_merkle_proofs: [merkle_tree.aleo::MerkleProof;2]
    ) -> (ComplianceRecord, token_registry.aleo::Token, Final) {
        let caller: address = self.caller;
        let root: field = merkle_tree.aleo::verify_non_inclusion(recipient, recipient_merkle_proofs);

        let owner: token_registry.aleo::TokenOwner = token_registry.aleo::TokenOwner {
            account: self.caller,
            token_id: TOKEN_ID
        };

        let authorization_call: Final = token_registry.aleo::prehook_public(
            owner,
            amount,
            AUTHORIZED_UNTIL
        );

        let transfer_call: (token_registry.aleo::Token, Final) = token_registry.aleo::transfer_from_public_to_private(
            TOKEN_ID,
            self.caller,
            recipient,
            amount,
            true
        );


        let compliance_record: ComplianceRecord = ComplianceRecord {
            owner: INVESTIGATOR_ADDRESS,
            amount: amount,
            sender: self.caller,
            recipient: recipient,
        };
        return (
            compliance_record,
            transfer_call.0,
            final {
                let is_sender_frozen: bool = freeze_list.get_or_use(caller, false);
                assert_eq(is_sender_frozen, false);

                let current_root: field = freeze_list_root.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
                if (current_root != root) {
                    let previous_root: field = freeze_list_root.get(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
                    assert_eq(root, previous_root);
                    let window: u32 = block_height_window.get(BLOCK_HEIGHT_WINDOW_INDEX);
                    let updated_height: u32 = root_updated_height.get(ROOT_UPDATED_HEIGHT_INDEX);
                    assert(updated_height + window > block.height);
                }

                authorization_call.run();
                transfer_call.1.run();
            }
        );
    }

    // Transfers private tokens from the record owner to a recipient.
    // A ComplianceRecord is emitted for the investigator, who must match the stored investigator role.
    // Both sender and recipient must not be frozen in the freeze list.
    // The sender's and recipient's privacy is preserved by proving non-inclusion in the freeze list Merkle tree.
    fn transfer_private(
        recipient: address,
        amount: u128,
        input_record: token_registry.aleo::Token,
        sender_merkle_proofs: [merkle_tree.aleo::MerkleProof;2],
        recipient_merkle_proofs: [merkle_tree.aleo::MerkleProof;2]
    ) -> (ComplianceRecord, token_registry.aleo::Token, token_registry.aleo::Token, Final) {
        assert_eq(input_record.token_id, TOKEN_ID);

        let sender_root: field = merkle_tree.aleo::verify_non_inclusion(input_record.owner, sender_merkle_proofs);
        let recipient_root: field = merkle_tree.aleo::verify_non_inclusion(recipient, recipient_merkle_proofs);
        assert_eq(sender_root, recipient_root);

        let authorization_call: (
            token_registry.aleo::Token, // unauthorized_record
            token_registry.aleo::Token, // authorized_record
            Final
        ) = token_registry.aleo::prehook_private(
            input_record,
            amount,
            AUTHORIZED_UNTIL
        );

        let transfer_call: (
            token_registry.aleo::Token, // sender record - the amount has to be zero. we don't need to return it
            token_registry.aleo::Token, // recipient record
            Final
        ) = token_registry.aleo::transfer_private(
            recipient,
            amount,
            authorization_call.1,
        );

        let compliance_record: ComplianceRecord = ComplianceRecord {
            owner: INVESTIGATOR_ADDRESS,
            amount: amount,
            sender: input_record.owner,
            recipient: recipient,
        };

        return (
            compliance_record,
            authorization_call.0,
            transfer_call.1,
            final {
                let current_root: field = freeze_list_root.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
                if (current_root != sender_root) {
                    let previous_root: field = freeze_list_root.get(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
                    assert_eq(sender_root, previous_root);
                    let window: u32 = block_height_window.get(BLOCK_HEIGHT_WINDOW_INDEX);
                    let updated_height: u32 = root_updated_height.get(ROOT_UPDATED_HEIGHT_INDEX);
                    assert(updated_height + window > block.height);
                }

                authorization_call.2.run();
                transfer_call.2.run();
            }
        );
    }

    // Transfers private tokens from the record owner to a recipient as a public tokens.
    // A ComplianceRecord is emitted for the investigator, who must match the stored investigator role.
    // Both sender and recipient must not be frozen in the freeze list.
    // The sender's privacy is preserved by proving non-inclusion in the freeze list Merkle tree.
    fn transfer_priv_to_public(
        public recipient: address,
        public amount: u128,
        input_record: token_registry.aleo::Token,
        sender_merkle_proofs: [merkle_tree.aleo::MerkleProof; 2]
    ) -> (ComplianceRecord, token_registry.aleo::Token, Final) {
        assert_eq(input_record.token_id, TOKEN_ID);

        let root: field = merkle_tree.aleo::verify_non_inclusion(input_record.owner, sender_merkle_proofs);

        let authorization_call: (
            token_registry.aleo::Token, // unauthorized_record
            token_registry.aleo::Token, // authorized_record
            Final
        ) = token_registry.aleo::prehook_private(
            input_record,
            amount,
            AUTHORIZED_UNTIL
        );

        // we don't need to return the record because the amount is zero
        let transfer_call: (token_registry.aleo::Token, Final) = token_registry.aleo::transfer_private_to_public(
            recipient,
            amount,
            authorization_call.1,
        );

        let compliance_record: ComplianceRecord = ComplianceRecord {
            owner: INVESTIGATOR_ADDRESS,
            amount: amount,
            sender: input_record.owner,
            recipient: recipient,
        };


        return (
            compliance_record,
            authorization_call.0,
            final {
                let is_recipient_frozen: bool = freeze_list.get_or_use(recipient, false);
                assert_eq(is_recipient_frozen, false);

                let current_root: field = freeze_list_root.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
                if (current_root != root) {
                    let previous_root: field = freeze_list_root.get(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
                    assert_eq(root, previous_root);
                    let window: u32 = block_height_window.get(BLOCK_HEIGHT_WINDOW_INDEX);
                    let updated_height: u32 = root_updated_height.get(ROOT_UPDATED_HEIGHT_INDEX);
                    assert(updated_height + window > block.height);
                }

                authorization_call.2.run();
                transfer_call.1.run();
            }
        );
    }
}
