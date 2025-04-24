import token_registry.aleo;
import uscrpnwqsx.aleo;

// The 'compliant_threshold_transfer' program.
program riwoxowhva.aleo {

    const TOKEN_ID: field = 438271370123737563379885991741056366field; // "Threshold Token" ascii encoded
    const ZERO_ADDRESS: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc; // ZERO_ADDRESS as field equals to 0field
    const PROGRAM_ADDRESS: address = aleo1w9w0zz3xlxngpws8q7cw9c98den5u3jkqt2y60effkphhe3urs8q5xhdtz;
    const AUTHORIZED_UNTIL: u32 = 4294967295u32;
    const FREEZE_REGISTRY_PROGRAM_NAME: u128 = 531934507715736310883939492834865785u128;// freeze_registry ascii encoded
    const THRESHOLD: u128 = 1000000u128;
    const EPOCH: u32 = 1800u32; // 1-2.5 hours 

    // Mappings
    mapping freeze_registry_program_name: u8 => u128;
    mapping threshold: u8 => u128;
    mapping epoch: u8 => u32;
    mapping block_height_window: u8 => u32; // it defines a window of blocks within which a transaction is considered valid:  block.height - window < estimated_block_height <= block.height
    mapping owned_state_record: address => bool;
 
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

    record TokenComplianceStateRecord {
        owner: address,
        cumulative_amount_per_epoch: u128,
        latest_block_height: u32
    }

    struct TokenOwner {
        account: address,
        token_id: field
    }

    async transition signup() -> (TokenComplianceStateRecord ,Future){
        let state_record: TokenComplianceStateRecord = TokenComplianceStateRecord {
            owner: self.caller,
            cumulative_amount_per_epoch: 0u128,
            latest_block_height: 0u32
        };
        return (state_record, f_signup(self.caller));
    }
    async function f_signup(caller: address) {
        let is_owned_state_record: bool = owned_state_record.get_or_use(caller, false);
        assert_eq(is_owned_state_record, false);

        owned_state_record.set(caller, true);
    }


    async transition update_block_height_window(public blocks: u32) -> Future {
        return f_update_block_height_window(blocks, self.caller);
    }
    async function f_update_block_height_window(blocks: u32, caller: address) {
        let admin_address: address = roles.get(1u8);
        assert_eq(admin_address, caller);

        block_height_window.set(0u8, blocks);
    }

    async transition init_mappings() -> Future {
        return f_init_mappings();
    }
    async function f_init_mappings() {
        freeze_registry_program_name.set(0u8, FREEZE_REGISTRY_PROGRAM_NAME);
        threshold.set(0u8, THRESHOLD);
        epoch.set(0u8, EPOCH);
    }

    async transition update_investigator_address(public new_investigator_address: address) -> Future {
        return f_update_investigator_address(new_investigator_address, self.caller);
    }
    async function f_update_investigator_address(new_investigator_address: address, caller: address) {
        let admin_address: address = roles.get(1u8);
        assert_eq(admin_address, caller);
        roles.set(2u8, new_investigator_address);
    }

    async transition update_admin_address(public new_admin_address: address) -> Future {
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
        public amount: u128,
        input_state_record: TokenComplianceStateRecord,
        public estimated_block_height: u32,
    ) -> (TokenComplianceStateRecord, Future) {
        let verify_sender: Future = uscrpnwqsx.aleo/verify_non_inclusion_pub(self.caller);
        let verify_recipient: Future = uscrpnwqsx.aleo/verify_non_inclusion_pub(recipient);


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

        assert(estimated_block_height >= input_state_record.latest_block_height);
        let current_epoch: u32 =  estimated_block_height / EPOCH;
        let previous_epoch: u32 =  input_state_record.latest_block_height / EPOCH;
        
        let cumulative_amount_per_epoch: u128 = current_epoch == previous_epoch 
            ? amount + input_state_record.cumulative_amount_per_epoch
            : amount;

        let state_record: TokenComplianceStateRecord = TokenComplianceStateRecord {
            owner: input_state_record.owner,
            cumulative_amount_per_epoch: cumulative_amount_per_epoch,
            latest_block_height: estimated_block_height
        };

        return (state_record, finalize_transfer_public(authorization_call, transfer_call, verify_sender, verify_recipient, estimated_block_height));
    }

    async function finalize_transfer_public(
        verify_sender: Future,
        verify_recipient: Future,
        authorization_call: Future,
        transfer_call: Future,
        public estimated_block_height: u32
    ) {
        verify_sender.await();
        verify_recipient.await();

        assert(block.height >= estimated_block_height);
        let window: u32 = block_height_window.get(0u8);
        window = block.height > window 
            ? window
            : block.height;
        assert(estimated_block_height > (block.height - window));
        authorization_call.await(); 
        transfer_call.await(); 
    }

    async transition transfer_public_as_signer(
        public recipient: address,
        public amount: u128,
        input_state_record: TokenComplianceStateRecord,
        public estimated_block_height: u32,
    ) -> (TokenComplianceStateRecord, Future) {
        let verify_sender: Future = uscrpnwqsx.aleo/verify_non_inclusion_pub(self.signer);
        let verify_recipient: Future = uscrpnwqsx.aleo/verify_non_inclusion_pub(recipient);

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

        assert(estimated_block_height >= input_state_record.latest_block_height);
        let current_epoch: u32 =  estimated_block_height / EPOCH;
        let previous_epoch: u32 =  input_state_record.latest_block_height / EPOCH;
        
        let cumulative_amount_per_epoch: u128 = current_epoch == previous_epoch 
            ? amount + input_state_record.cumulative_amount_per_epoch
            : amount;

        let state_record: TokenComplianceStateRecord = TokenComplianceStateRecord {
            owner: input_state_record.owner,
            cumulative_amount_per_epoch: cumulative_amount_per_epoch,
            latest_block_height: estimated_block_height
        };

        return (state_record, f_transfer_public_as_signer(authorization_call, transfer_call, verify_sender, verify_recipient, estimated_block_height));
    }

    async function f_transfer_public_as_signer(
        verify_sender: Future,
        verify_recipient: Future,
        authorization_call: Future,
        transfer_call: Future,
        public estimated_block_height: u32
    ) {
        verify_sender.await();
        verify_recipient.await();

        assert(block.height >= estimated_block_height);
        let window: u32 = block_height_window.get(0u8);
        window = block.height > window 
            ? window
            : block.height;
        assert(estimated_block_height > (block.height - window));
        authorization_call.await();
        transfer_call.await();
    }

    async transition transfer_public_to_priv(
        recipient: address,
        public amount: u128,
        input_state_record: TokenComplianceStateRecord,
        public estimated_block_height: u32,
        recipient_merkle_proofs: [MerkleProof;2],
        public investigator_address: address
    ) -> (ComplianceRecord, TokenComplianceStateRecord, token_registry.aleo/Token, Future) {
        let verify_sender: Future = uscrpnwqsx.aleo/verify_non_inclusion_pub(self.caller);
        let verify_recipient: Future = uscrpnwqsx.aleo/verify_non_inclusion_priv(recipient, recipient_merkle_proofs);
        
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

        assert(estimated_block_height >= input_state_record.latest_block_height);
        let current_epoch: u32 =  estimated_block_height / EPOCH;
        let previous_epoch: u32 =  input_state_record.latest_block_height / EPOCH;
        
        let cumulative_amount_per_epoch: u128 = current_epoch == previous_epoch 
            ? amount + input_state_record.cumulative_amount_per_epoch
            : amount;

        let state_record: TokenComplianceStateRecord = TokenComplianceStateRecord {
            owner: input_state_record.owner,
            cumulative_amount_per_epoch: cumulative_amount_per_epoch,
            latest_block_height: estimated_block_height
        };

        let is_above_threshold: bool = cumulative_amount_per_epoch > THRESHOLD;
        let sender: address = self.caller;
        let compliance_record: ComplianceRecord = ComplianceRecord {
            owner: is_above_threshold ? investigator_address : ZERO_ADDRESS,
            amount: is_above_threshold ? amount : 0u128,
            sender: is_above_threshold ? sender : ZERO_ADDRESS,
            recipient: is_above_threshold ? recipient : ZERO_ADDRESS,
        };

        return (
            compliance_record,
            state_record, 
            transfer_to_recipient.0, 
            f_transfer_public_to_priv(
                verify_sender,
                verify_recipient,
                authorization_call_for_caller,
                transfer_to_program,
                authorization_call_for_program, 
                transfer_to_recipient.1, 
                investigator_address,
                estimated_block_height
            )
        );
    }
    async function f_transfer_public_to_priv(
        verify_sender: Future,
        verify_recipient: Future,
        authorization_call_for_caller: Future,
        transfer_to_program: Future,
        authorization_call_for_program: Future,
        transfer_to_recipient: Future,
        investigator_address: address,
        public estimated_block_height: u32
    ) {
        verify_sender.await();
        verify_recipient.await();

        let caller_address: address = roles.get(2u8);
        assert_eq(caller_address, investigator_address);

        assert(block.height >= estimated_block_height);
        let window: u32 = block_height_window.get(0u8);
        window = block.height > window 
            ? window
            : block.height;
        assert(estimated_block_height > (block.height - window));
        authorization_call_for_caller.await();
        transfer_to_program.await();
        authorization_call_for_program.await();
        transfer_to_recipient.await();
    }

    async transition transfer_private(
        recipient: address,
        amount: u128,
        input_record: token_registry.aleo/Token,
        input_state_record: TokenComplianceStateRecord,
        public estimated_block_height: u32,
        sender_merkle_proofs: [MerkleProof;2],
        recipient_merkle_proofs: [MerkleProof;2],
        public investigator_address: address
    ) -> (ComplianceRecord, TokenComplianceStateRecord, token_registry.aleo/Token, token_registry.aleo/Token, Future) {
        assert_eq(input_record.token_id, TOKEN_ID);

        let verify_sender: Future = uscrpnwqsx.aleo/verify_non_inclusion_priv(input_record.owner, sender_merkle_proofs);
        let verify_recipient: Future = uscrpnwqsx.aleo/verify_non_inclusion_priv(recipient, recipient_merkle_proofs);

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

        assert(estimated_block_height >= input_state_record.latest_block_height);
        let current_epoch: u32 =  estimated_block_height / EPOCH;
        let previous_epoch: u32 =  input_state_record.latest_block_height / EPOCH;
        
        let cumulative_amount_per_epoch: u128 = current_epoch == previous_epoch 
            ? amount + input_state_record.cumulative_amount_per_epoch
            : amount;


        let state_record: TokenComplianceStateRecord = TokenComplianceStateRecord {
            owner: input_state_record.owner,
            cumulative_amount_per_epoch: cumulative_amount_per_epoch,
            latest_block_height: estimated_block_height
        };

        let is_above_threshold: bool = cumulative_amount_per_epoch > THRESHOLD;
        let compliance_record: ComplianceRecord = ComplianceRecord {
            owner: is_above_threshold ? investigator_address : ZERO_ADDRESS,
            amount: is_above_threshold ? amount : 0u128,
            sender: is_above_threshold ? input_record.owner : ZERO_ADDRESS,
            recipient: is_above_threshold ? recipient : ZERO_ADDRESS,
        };

        return (
            compliance_record,
            state_record,
            authorization_call.0, 
            transfer_call.1, 
            f_transfer_private(
                verify_sender,
                verify_recipient,
                authorization_call.2,
                transfer_call.2,
                investigator_address,
                estimated_block_height
            )
        );
    }

    async function f_transfer_private(
        verify_sender: Future,
        verify_recipient: Future,  
        authorization_call: Future,
        transfer_call: Future,       
        investigator_address: address,
        public estimated_block_height: u32
    ) {
        verify_sender.await();
        verify_recipient.await();

        let caller_address: address = roles.get(2u8);
        assert_eq(caller_address, investigator_address);

        assert(block.height >= estimated_block_height);
        let window: u32 = block_height_window.get(0u8);
        window = block.height > window 
            ? window
            : block.height;
        assert(estimated_block_height > (block.height - window));

        authorization_call.await();
        transfer_call.await();
    }

        async transition transfer_priv_to_public(
        public recipient: address,
        public amount: u128,
        input_record: token_registry.aleo/Token,
        input_state_record: TokenComplianceStateRecord,
        public estimated_block_height: u32,
        sender_merkle_proofs: [MerkleProof; 2],
        public investigator_address: address,
    ) -> (ComplianceRecord, TokenComplianceStateRecord, token_registry.aleo/Token, Future) {
        assert_eq(input_record.token_id, TOKEN_ID);
        
        let verify_sender: Future = uscrpnwqsx.aleo/verify_non_inclusion_priv(input_record.owner, sender_merkle_proofs);
        let verify_recipient: Future = uscrpnwqsx.aleo/verify_non_inclusion_pub(recipient);

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

        assert(estimated_block_height >= input_state_record.latest_block_height);
        let current_epoch: u32 =  estimated_block_height / EPOCH;
        let previous_epoch: u32 =  input_state_record.latest_block_height / EPOCH;
        
        let cumulative_amount_per_epoch: u128 = current_epoch == previous_epoch 
            ? amount + input_state_record.cumulative_amount_per_epoch
            : amount;

        let state_record: TokenComplianceStateRecord = TokenComplianceStateRecord {
            owner: input_state_record.owner,
            cumulative_amount_per_epoch: cumulative_amount_per_epoch,
            latest_block_height: estimated_block_height
        };

        let is_above_threshold: bool = cumulative_amount_per_epoch > THRESHOLD;
        let compliance_record: ComplianceRecord = ComplianceRecord {
            owner: is_above_threshold ? investigator_address : ZERO_ADDRESS,
            amount: is_above_threshold ? amount : 0u128,
            sender: is_above_threshold ? input_record.owner : ZERO_ADDRESS,
            recipient: is_above_threshold ? recipient : ZERO_ADDRESS,
        };
        
        return (
            compliance_record, 
            state_record,
            authorization_call.0,
            f_transfer_priv_to_public(
                authorization_call.2, 
                transfer_call.1, 
                verify_sender,
                verify_recipient,
                investigator_address,
                estimated_block_height
            )
        );
    }

    async function f_transfer_priv_to_public(
        verify_sender: Future,
        verify_recipient: Future,
        authorization_call: Future,
        transfer_call: Future,
        investigator_address: address,
        public estimated_block_height: u32
    ) {
        verify_sender.await();
        verify_recipient.await();
        
        let caller_address: address = roles.get(2u8);
        assert_eq(caller_address, investigator_address);

        assert(block.height >= estimated_block_height);
        let window: u32 = block_height_window.get(0u8);
        window = block.height > window 
            ? window
            : block.height;
        assert(estimated_block_height > (block.height - window));
        authorization_call.await();
        transfer_call.await();
    }
}