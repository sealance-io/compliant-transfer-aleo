import token_registry.aleo;
import rediwsozfo.aleo;

program tqxftxoicd.aleo {

    const TOKEN_ID: field = 100667890849571067315045710field; // SEALEDTOKEN ascii encoded
    const ZERO_ADDRESS: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc; // ZERO_ADDRESS as field equals to 0field
    const PROGRAM_ADDRESS: address = aleo10ha27yxrya7d7lf0eg5p3hqcafm8k6nj00pvgeuxuqmvhqpst5xsdh2ft4;
    const AUTHORIZED_UNTIL: u32 = 4294967295u32;

    // Mappings
    mapping freeze_list: address => bool; // Indicates if address is frozen
    mapping freeze_list_index: u32 => address; // Mimic an array of all the frozen addresses
    mapping freeze_list_root: u8 => field;

    const ADMIN_ROLE: u8 = 1u8;
    const INVESTIGATOR_ROLE: u8 = 2u8;
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

    async transition update_freeze_list(account: address, is_freezed: bool, freezed_index: u32, new_root: field) -> Future {
        return f_update_freeze_list(account, is_freezed, freezed_index, self.caller, new_root);
    }
    async function f_update_freeze_list(account: address, is_freezed: bool, freezed_index: u32, caller: address, new_root: field) {
        let admin_address: address = roles.get(1u8);
        assert_eq(admin_address, caller);
        freeze_list.set(account, is_freezed);
        freeze_list_index.set(freezed_index, is_freezed ? account : ZERO_ADDRESS);
        freeze_list_root.set(0u8, new_root);
    }

    async transition update_investigator_address(new_investigator_address: address) -> Future {
        return f_update_investigator_address(new_investigator_address, self.caller);
    }
    async function f_update_investigator_address(new_investigator_address: address, caller: address) {
        let admin_address: address = roles.get(1u8);
        assert_eq(admin_address, caller);
        roles.set(2u8, new_investigator_address);
    }

    async transition update_admin_address(new_admin_address: address) -> Future {
        return f_update_admin_address(new_admin_address, self.caller);
    }
    async function f_update_admin_address(new_admin_address: address, caller: address) {
        let admin_address: address = roles.get_or_use(1u8, caller);
        assert_eq(admin_address, caller);
        roles.set(1u8, new_admin_address);
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
        investigator_address: address
    ) -> (ComplianceRecord, token_registry.aleo/Token, Future) {
        let root: field = rediwsozfo.aleo/verify_non_inclusion(recipient, recipient_merkle_proofs);

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

        let current_root: field = freeze_list_root.get(0u8);
        assert_eq(root, current_root);

        let address: address = roles.get(2u8);
        assert_eq(address, investigator_address);

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
        investigator_address: address
    ) -> (ComplianceRecord, token_registry.aleo/Token, token_registry.aleo/Token, Future) {
        let sender_root: field = rediwsozfo.aleo/verify_non_inclusion(input_record.owner, sender_merkle_proofs);
        let recipient_root: field = rediwsozfo.aleo/verify_non_inclusion(recipient, recipient_merkle_proofs);
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
        let current_root: field = freeze_list_root.get(0u8);
        assert_eq(root, current_root);
        
        let address: address = roles.get(2u8);
        assert_eq(address, investigator_address);

        authorization_call.await();
        transfer_call.await();
    }

        async transition transfer_priv_to_public(
        public recipient: address,
        public amount: u128,
        input_record: token_registry.aleo/Token,
        sender_merkle_proofs: [MerkleProof; 2],
        investigator_address: address
    ) -> (ComplianceRecord, token_registry.aleo/Token, Future) {
        let root: field = rediwsozfo.aleo/verify_non_inclusion(input_record.owner, sender_merkle_proofs);

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
       
        let current_root: field = freeze_list_root.get(0u8);
        assert_eq(root, current_root);
        
        let address: address = roles.get(2u8);
        assert_eq(address, investigator_address);

        authorization_call.await();
        transfer_call.await();
    }
}