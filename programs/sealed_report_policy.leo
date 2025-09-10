import token_registry.aleo;
import merkle_tree.aleo;

program sealed_report_policy.aleo {
    @custom
    async constructor() {
        let admin_address: address = roles.get_or_use(ADMIN_INDEX, self.program_owner);
        assert_eq(admin_address, self.program_owner);
    }
    
    const TOKEN_ID: field = 475390673649194485158084951104358477375241536345field; // SEALED_REPORT ascii encoded
    const ZERO_ADDRESS: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc; // ZERO_ADDRESS as field equals to 0field
    const PROGRAM_ADDRESS: address = aleo18t5vlckuaxxaujsl0q03lqs690cgk0zfca6lj3hpeqk5kh4zzupqtzr7j2;
    // Set to the maximum u32 to avoid expiration. However, the asset is always used immediately in the same transaction
    const AUTHORIZED_UNTIL: u32 = 4294967295u32;
    const EMPTY_ROOT: field = 7233124799133753665783241350706390908532988676951941973288057571394699151001field; // hash of H(ZERO_ADDRESS, ZERO_ADDRESS)

    // Admin: can assign roles, update the freeze list and upgrade the program
    const ADMIN_INDEX: u8 = 1u8;
    // Investigator: receives compliant records with transaction details
    const INVESTIGATOR_INDEX: u8 = 2u8;
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
    // Maps a role ID to an address (e.g., 1 = admin, 2 = investigator).
    mapping roles: u8 => address;

    struct MerkleProof {
        siblings: [field; 16],
        leaf_index: u32
    }

    // Compliance record used for the investigator
    record ComplianceRecord {
        owner: address,
        amount: u128,
        sender: address,
        recipient: address
    }

    struct TokenOwner {
        account: address,
        token_id: field
    }

    // Initializes the freeze list.
    // Can only be called once — ensures the contract has not already been initialized.
    // Sets the block height window, the initial empty Merkle root,
    // and initialize the freeze_list_last_index, freeze_list, and freeze_list_index with a ZERO_ADDRESS placeholder.
    async transition initialize(public blocks: u32) -> Future {
        return f_initialize(blocks);
    }
    async function f_initialize(blocks: u32) {
        let is_already_initialized: bool = freeze_list_root.contains(CURRENT_FREEZE_LIST_ROOT_INDEX);
        assert_eq(is_already_initialized, false);

        block_height_window.set(BLOCK_HEIGHT_WINDOW_INDEX, blocks);
        freeze_list_last_index.set(FREEZE_LIST_LAST_INDEX, 0u32);
        freeze_list_root.set(CURRENT_FREEZE_LIST_ROOT_INDEX, EMPTY_ROOT);
        freeze_list.set(ZERO_ADDRESS, false);
        freeze_list_index.set(0u32, ZERO_ADDRESS);
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
        let admin_address: address = roles.get(ADMIN_INDEX);
        if(admin_address != caller) {
            let freeze_list_manager_address: address = roles.get(FREEZE_LIST_MANAGER_INDEX);
            assert_eq(freeze_list_manager_address, caller);
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
            // Verify that the frozen_index is empty
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
            // Verify we update the correct frozen_index
            assert_eq(current_address_at_index, account);
            freeze_list_index.set(frozen_index, ZERO_ADDRESS);
        }

        root_updated_height.set(ROOT_UPDATED_HEIGHT_INDEX, block.height);
    }

    // Updates the address assigned to a given role.
    // Can only be called by the current admin.
    // If no admin is set yet, the caller is temporarily treated as admin.
    async transition update_role(public new_address: address, role: u8) -> Future {
        return f_update_role(new_address, self.caller, role);
    }
    async function f_update_role(new_address: address, caller: address, role: u8) {
        let admin_address: address = roles.get_or_use(ADMIN_INDEX, caller);
        assert_eq(admin_address, caller);
        roles.set(role, new_address);
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

    // -------------------------
    // Called by token owners/DeFi contracts
    // -------------------------

    // Transfers public tokens from the caller to the recipient.
    // The caller must first approve this contract in the token_registry via the approve transition.
    // Both sender and recipient must not be frozen in the freeze list.
    async transition transfer_public(
        public recipient: address,
        public amount: u128
    ) -> Future {
        let owner: TokenOwner = TokenOwner {
            account: self.caller,
            token_id: TOKEN_ID
        };
        let authorization_call: Future = token_registry.aleo/prehook_public(
            owner,
            amount,
            AUTHORIZED_UNTIL
        );

        let transfer_call: Future = token_registry.aleo/transfer_from_public(
            TOKEN_ID,
            self.caller,
            recipient,
            amount
        );
        return finalize_transfer_public(authorization_call, transfer_call, self.caller, recipient);
    }

    async function finalize_transfer_public(
        authorization_call: Future,
        transfer_call: Future,
        sender: address,
        recipient: address
    ) {
        let is_sender_frozen: bool = freeze_list.get_or_use(sender, false);
        assert_eq(is_sender_frozen, false);
        let is_recipient_frozen: bool = freeze_list.get_or_use(recipient, false);
        assert_eq(is_recipient_frozen, false);

        authorization_call.await(); 
        transfer_call.await(); 
    }

    // Transfers public tokens from the signer to the recipient.
    // Both sender and recipient must not be frozen in the freeze list.
    async transition transfer_public_as_signer(
        public recipient: address,
        public amount: u128
    ) -> Future {
        let owner: TokenOwner = TokenOwner {
            account: self.signer,
            token_id: TOKEN_ID
        };

        let authorization_call: Future = token_registry.aleo/prehook_public(
            owner,
            amount,
            AUTHORIZED_UNTIL
        );

        let transfer_call: Future = token_registry.aleo/transfer_public_as_signer(
            TOKEN_ID,
            recipient,
            amount
        );
        return f_transfer_public_as_signer(authorization_call, transfer_call, self.signer, recipient);
    }

    async function f_transfer_public_as_signer(
        authorization_call: Future,
        transfer_call: Future,
        sender: address,
        recipient: address
    ) {
        let is_sender_frozen: bool = freeze_list.get_or_use(sender, false);
        assert_eq(is_sender_frozen, false);
        let is_recipient_frozen: bool = freeze_list.get_or_use(recipient, false);
        assert_eq(is_recipient_frozen, false);

        authorization_call.await();
        transfer_call.await();
    }

    // Transfers public tokens from the caller to a recipient as a private token.
    // The caller must first approve this contract in the token_registry via the approve transition.
    // A ComplianceRecord is emitted for the investigator, who must match the stored investigator role.
    // Both sender and recipient must not be frozen in the freeze list.
    // The recipient's privacy is preserved by proving non-inclusion in the freeze list Merkle tree.
    async transition transfer_public_to_priv(
        recipient: address,
        public amount: u128,
        recipient_merkle_proofs: [MerkleProof;2],
        public investigator_address: address
    ) -> (ComplianceRecord, token_registry.aleo/Token, Future) {
        let root: field = merkle_tree.aleo/verify_non_inclusion(recipient, recipient_merkle_proofs);

        let owner: TokenOwner = TokenOwner {
            account: self.caller,
            token_id: TOKEN_ID
        };

        let authorization_call_for_caller: Future = token_registry.aleo/prehook_public(
            owner,
            amount,
            AUTHORIZED_UNTIL
        );

        let transfer_to_program: Future = token_registry.aleo/transfer_from_public(
            TOKEN_ID,
            self.caller,
            PROGRAM_ADDRESS,
            amount,
        );

        let program_owner: TokenOwner = TokenOwner {
            account: PROGRAM_ADDRESS,
            token_id: TOKEN_ID
        };

        let authorization_call_for_program: Future = token_registry.aleo/prehook_public(
            program_owner,
            amount,
            AUTHORIZED_UNTIL
        );

        let transfer_to_recipient: (token_registry.aleo/Token, Future) = token_registry.aleo/transfer_public_to_private(
            TOKEN_ID,
            recipient,
            amount,
            true,
        );

        let compliance_record: ComplianceRecord = ComplianceRecord {
            owner: investigator_address,
            amount: amount,
            sender: self.caller,
            recipient: recipient,
        };
        return (
            compliance_record, 
            transfer_to_recipient.0, 
            f_transfer_public_to_priv(
                authorization_call_for_caller,
                transfer_to_program,
                authorization_call_for_program, 
                transfer_to_recipient.1, 
                self.caller,
                root,
                investigator_address
            )
        );
    }
    async function f_transfer_public_to_priv(
        authorization_call_for_caller: Future,
        transfer_to_program: Future,
        authorization_call_for_program: Future,
        transfer_to_recipient: Future,
        sender: address,
        root: field,
        investigator_address: address
    ) {
        let is_sender_frozen: bool = freeze_list.get_or_use(sender, false);
        assert_eq(is_sender_frozen, false);

        let current_root: field = freeze_list_root.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
        if (current_root != root) {
            let previous_root: field = freeze_list_root.get(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
            assert_eq(root, previous_root);
            let window: u32 = block_height_window.get(BLOCK_HEIGHT_WINDOW_INDEX);
            let updated_height: u32 = root_updated_height.get(ROOT_UPDATED_HEIGHT_INDEX);
            assert(updated_height + window > block.height);
        }

        let stored_investigator_address: address = roles.get(INVESTIGATOR_INDEX);
        assert_eq(stored_investigator_address, investigator_address);

        authorization_call_for_caller.await();
        transfer_to_program.await();
        authorization_call_for_program.await();
        transfer_to_recipient.await();
    }

    // Transfers private tokens from the record owner to a recipient.
    // A ComplianceRecord is emitted for the investigator, who must match the stored investigator role.
    // Both sender and recipient must not be frozen in the freeze list.
    // The sender's and recipient's privacy is preserved by proving non-inclusion in the freeze list Merkle tree.
    async transition transfer_private(
        recipient: address,
        amount: u128,
        input_record: token_registry.aleo/Token,
        sender_merkle_proofs: [MerkleProof;2],
        recipient_merkle_proofs: [MerkleProof;2],
        public investigator_address: address
    ) -> (ComplianceRecord, token_registry.aleo/Token, token_registry.aleo/Token, Future) {
        assert_eq(input_record.token_id, TOKEN_ID);

        let sender_root: field = merkle_tree.aleo/verify_non_inclusion(input_record.owner, sender_merkle_proofs);
        let recipient_root: field = merkle_tree.aleo/verify_non_inclusion(recipient, recipient_merkle_proofs);
        assert_eq(sender_root, recipient_root);

        let authorization_call: (
            token_registry.aleo/Token, // unauthorized_record
            token_registry.aleo/Token, // authorized_record
            Future
        ) = token_registry.aleo/prehook_private(
            input_record, 
            amount, 
            AUTHORIZED_UNTIL
        );

        let transfer_call: (
            token_registry.aleo/Token, // sender record - the amount has to be zero. we don't need to return it
            token_registry.aleo/Token, // recipient record
            Future
        ) = token_registry.aleo/transfer_private(
            recipient,
            amount,
            authorization_call.1,
        );

        let compliance_record: ComplianceRecord = ComplianceRecord {
            owner: investigator_address,
            amount: amount,
            sender: input_record.owner,
            recipient: recipient,
        };

        return (
            compliance_record,
            authorization_call.0, 
            transfer_call.1, 
            f_transfer_private(
                authorization_call.2,
                transfer_call.2,
                sender_root,
                investigator_address 
            )
        );
    }

    async function f_transfer_private(
        authorization_call: Future,
        transfer_call: Future,
        root: field,
        investigator_address: address
    ) {
        let current_root: field = freeze_list_root.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
        if (current_root != root) {
            let previous_root: field = freeze_list_root.get(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
            assert_eq(root, previous_root);
            let window: u32 = block_height_window.get(BLOCK_HEIGHT_WINDOW_INDEX);
            let updated_height: u32 = root_updated_height.get(ROOT_UPDATED_HEIGHT_INDEX);
            assert(updated_height + window > block.height);
        }
        
        let stored_investigator_address: address = roles.get(INVESTIGATOR_INDEX);
        assert_eq(stored_investigator_address, investigator_address);

        authorization_call.await();
        transfer_call.await();
    }

    // Transfers private tokens from the record owner to a recipient as a public tokens.
    // A ComplianceRecord is emitted for the investigator, who must match the stored investigator role.
    // Both sender and recipient must not be frozen in the freeze list.
    // The sender's privacy is preserved by proving non-inclusion in the freeze list Merkle tree.
    async transition transfer_priv_to_public(
        public recipient: address,
        public amount: u128,
        input_record: token_registry.aleo/Token,
        sender_merkle_proofs: [MerkleProof; 2],
        public investigator_address: address
    ) -> (ComplianceRecord, token_registry.aleo/Token, Future) {
        assert_eq(input_record.token_id, TOKEN_ID);

        let root: field = merkle_tree.aleo/verify_non_inclusion(input_record.owner, sender_merkle_proofs);

        let authorization_call: (
            token_registry.aleo/Token, // unauthorized_record
            token_registry.aleo/Token, // authorized_record
            Future
        ) = token_registry.aleo/prehook_private(
            input_record, 
            amount, 
            AUTHORIZED_UNTIL
        );

        // we don't need to return the record because the amount is zero
        let transfer_call: (token_registry.aleo/Token, Future) = token_registry.aleo/transfer_private_to_public(
            recipient,
            amount,
            authorization_call.1,
        );
        
        let compliance_record: ComplianceRecord = ComplianceRecord {
            owner: investigator_address,
            amount: amount,
            sender: input_record.owner,
            recipient: recipient,
        };

        
        return (
            compliance_record, 
            authorization_call.0,
            f_transfer_priv_to_public(
                authorization_call.2, 
                transfer_call.1, 
                recipient,
                root,
                investigator_address
            )
        );
    }
    async function f_transfer_priv_to_public(
        authorization_call: Future,
        transfer_call: Future,
        recipient: address,
        root: field,
        investigator_address: address
    ) {
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
        
        let stored_investigator_address: address = roles.get(INVESTIGATOR_INDEX);
        assert_eq(stored_investigator_address, investigator_address);

        authorization_call.await();
        transfer_call.await();
    }
}