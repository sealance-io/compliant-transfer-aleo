import token_registry.aleo;
import merkle_tree.aleo;

program sealed_report_policy.aleo {

    const TOKEN_ID: field = 475390673649194485158084951104358477375241536345field; // SEALED_REPORT ascii encoded
    const ZERO_ADDRESS: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc; // ZERO_ADDRESS as field equals to 0field
    const PROGRAM_ADDRESS: address = aleo18t5vlckuaxxaujsl0q03lqs690cgk0zfca6lj3hpeqk5kh4zzupqtzr7j2;
    const AUTHORIZED_UNTIL: u32 = 4294967295u32;

    const ADMIN_INDEX: u8 = 1u8;
    const INVESTIGATOR_INDEX: u8 = 2u8;
    const CURRENT_FREEZE_LIST_ROOT_INDEX: u8 = 1u8;
    const PREVIOUS_FREEZE_LIST_ROOT_INDEX: u8 = 2u8;
    const ROOT_UPDATED_HEIGHT_INDEX: bool = true;
    const BLOCK_HEIGHT_WINDOW_INDEX: bool = true;
    const FREEZE_LIST_LAST_INDEX: bool = true;

    // Mappings
    mapping freeze_list: address => bool; // Indicates if address is frozen
    mapping freeze_list_index: u32 => address; // Mimic an array of all the frozen addresses
    mapping freeze_list_last_index: bool => u32;
    mapping freeze_list_root: u8 => field;
    mapping root_updated_height: bool => u32;
    mapping block_height_window: bool => u32; // it defines a window of blocks within which the old root is considered valid
    mapping roles: u8 => address;

    struct MerkleProof {
        siblings: [field; 16],
        leaf_index: u32
    }

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

    async transition update_freeze_list(public account: address, public is_freezed: bool, public freezed_index: u32, public new_root: field) -> Future {
        return f_update_freeze_list(account, is_freezed, freezed_index, self.caller, new_root);
    }
    async function f_update_freeze_list(account: address, is_freezed: bool, freezed_index: u32, caller: address, new_root: field) {
        let admin_address: address = roles.get(ADMIN_INDEX);
        assert_eq(admin_address, caller);

        let old_root: field = freeze_list_root.get_or_use(CURRENT_FREEZE_LIST_ROOT_INDEX, 0field);
        freeze_list_root.set(PREVIOUS_FREEZE_LIST_ROOT_INDEX, old_root);
        freeze_list_root.set(CURRENT_FREEZE_LIST_ROOT_INDEX, new_root);

        // Verify we don't unfreeze an unfrozen account or freeze a frozen account
        let stored_is_freezed = freeze_list.get_or_use(account, false);
        assert_neq(is_freezed, stored_is_freezed);
        freeze_list.set(account, is_freezed);

        let current_address_at_index: address = freeze_list_index.get_or_use(freezed_index, ZERO_ADDRESS);
        if (is_freezed) {
            // Verify that the freezed_index is empty
            assert_eq(current_address_at_index, ZERO_ADDRESS);
            
            // Verify that if the freeze_list_last_index was not initialized the freezed_index is 0
            let is_last_index_initialized: bool = freeze_list_last_index.contains(FREEZE_LIST_LAST_INDEX);
            if (!is_last_index_initialized) {
                assert_eq(freezed_index, 0u32);
                freeze_list_last_index.set(FREEZE_LIST_LAST_INDEX, 0u32);
            } else {
                // Verify that the freezed index equal or smaller than the last index plus 1
                let last_index: u32 = freeze_list_last_index.get_or_use(FREEZE_LIST_LAST_INDEX, 0u32);
                assert(last_index + 1u32 >= freezed_index);
        
                // Update the freeze_list_last_index
                if (last_index < freezed_index) {
                    freeze_list_last_index.set(FREEZE_LIST_LAST_INDEX, freezed_index);
                }
            }

            freeze_list_index.set(freezed_index, account);
        } else {
            // Verify we update the correct freezed_index
            assert_eq(current_address_at_index, account);
            freeze_list_index.set(freezed_index, ZERO_ADDRESS);
        }

        root_updated_height.set(ROOT_UPDATED_HEIGHT_INDEX, block.height);
    }

   async transition update_role(public new_address: address, role: u8) -> Future {
        return f_update_role(new_address, self.caller, role);
    }
    async function f_update_role(new_address: address, caller: address, role: u8) {
        let admin_address: address = roles.get_or_use(ADMIN_INDEX, caller);
        assert_eq(admin_address, caller);
        roles.set(role, new_address);
    }

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

    // The caller has to approve this contract to call this function
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
        let is_sender_freezed: bool = freeze_list.get_or_use(sender, false);
        assert_eq(is_sender_freezed, false);
        let is_recipient_freezed: bool = freeze_list.get_or_use(recipient, false);
        assert_eq(is_recipient_freezed, false);

        authorization_call.await(); 
        transfer_call.await(); 
    }

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
        let is_sender_freezed: bool = freeze_list.get_or_use(sender, false);
        assert_eq(is_sender_freezed, false);
        let is_recipient_freezed: bool = freeze_list.get_or_use(recipient, false);
        assert_eq(is_recipient_freezed, false);

        authorization_call.await();
        transfer_call.await();
    }

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
        let is_sender_freezed: bool = freeze_list.get_or_use(sender, false);
        assert_eq(is_sender_freezed, false);

        let current_root: field = freeze_list_root.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
        if (current_root != root) {
            let previous_root: field = freeze_list_root.get(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
            assert_eq(root, previous_root);
            let window: u32 = block_height_window.get_or_use(BLOCK_HEIGHT_WINDOW_INDEX, 0u32);
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
            let window: u32 = block_height_window.get_or_use(BLOCK_HEIGHT_WINDOW_INDEX, 0u32);
            let updated_height: u32 = root_updated_height.get(ROOT_UPDATED_HEIGHT_INDEX);
            assert(updated_height + window > block.height);
        }
        
        let stored_investigator_address: address = roles.get(INVESTIGATOR_INDEX);
        assert_eq(stored_investigator_address, investigator_address);

        authorization_call.await();
        transfer_call.await();
    }

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
        let is_recipient_freezed: bool = freeze_list.get_or_use(recipient, false);
        assert_eq(is_recipient_freezed, false);
       
        let current_root: field = freeze_list_root.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
        if (current_root != root) {
            let previous_root: field = freeze_list_root.get(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
            assert_eq(root, previous_root);
            let window: u32 = block_height_window.get_or_use(BLOCK_HEIGHT_WINDOW_INDEX, 0u32);
            let updated_height: u32 = root_updated_height.get(ROOT_UPDATED_HEIGHT_INDEX);
            assert(updated_height + window > block.height);
        }
        
        let stored_investigator_address: address = roles.get(INVESTIGATOR_INDEX);
        assert_eq(stored_investigator_address, investigator_address);

        authorization_call.await();
        transfer_call.await();
    }
}