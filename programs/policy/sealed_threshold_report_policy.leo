import token_registry.aleo;
import sealance_freezelist_registry.aleo;
import multisig_core.aleo;

program sealed_threshold_report_policy.aleo {
    @custom
    async constructor() {
        // Only require multisig for upgrades - initial deployment has no checks.
        if self.edition > 0u16 {
            let signing_op_id = BHP256::hash_to_field(ChecksumEdition { checksum: self.checksum, edition: self.edition });

            let wallet_signing_op_id_hash = BHP256::hash_to_field(WalletSigningOpId { wallet_id: self.address, signing_op_id: signing_op_id });
            let signing_complete = multisig_core.aleo/completed_signing_ops.contains(wallet_signing_op_id_hash);
            assert(signing_complete);
        }
    }

    const TOKEN_ID: field = 574712059778503139260725892318697246579807451239563150109743143935624025field; // "Threshold Token" ascii encoded
    const ZERO_ADDRESS: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc; // ZERO_ADDRESS as field equals to 0field
    const AUTHORIZED_UNTIL: u32 = 4294967295u32; // Set to the maximum u32 to avoid expiration. However, the asset is always used immediately in the same transaction
    const FREEZE_REGISTRY_PROGRAM_NAME: u128 = 531934507715736310883939492834865785u128;// freeze_registry ascii encoded
    const THRESHOLD: u128 = 1000000000u128; // 1000 tokens
    // Only this address can initialize the program
    const INITIAL_CONFIGURATION_ADDRESS: address = aleo1mh7al4qsedqvsh64pmmlcmzl5ugmrdxp4a4rdneja7etn8cpuspqvrj9q8;
    // This address receives compliance records (can be updated with the contract upgrade)
    const INVESTIGATOR_ADDRESS: address = aleo12ux3gdauck0v60westgcpqj7v8rrcr3v346e4jtq04q7kkt22czsh808v2;

    // Info: 1 block per 10 seconds (approx)
    // Reference: https://github.com/ProvableHQ/snarkVM/blob/staging/console/network/src/lib.rs#L152
    const EPOCH: u32 = 8640u32; // ~24 hours, 3600/10 * 24 = 8640

    const FREEZE_REGISTRY_PROGRAM_INDEX: bool = true;
    const EPOCH_INDEX: bool = true;
    const THRESHOLD_INDEX: bool = true;
    const BLOCK_HEIGHT_WINDOW_INDEX: bool = true;
    
    // Mappings
    // Stores the ASCII-encoded name of the freeze registry program.
    // Used by off-chain parties to locate the correct program for generating Merkle proofs.
    mapping freeze_registry_program_name: bool => u128;
    // Stores the THRESHOLD constant for off-chain visibility.
    mapping threshold: bool => u128;
    // Stores the EPOCH constant for off-chain visibility.
    mapping epoch: bool => u32;
    // Defines the number of blocks within which an estimated block height is considered valid:
    // (block.height - window) < estimated_block_height ≤ block.height
    mapping block_height_window: bool => u32;
    // Tracks which addresses have already generated a TokenComplianceStateRecord.
    mapping owned_state_record: address => bool;

    // Roles can be assigned using bitmasking to allow multiple roles per address
    const NONE_ROLE: u16 = 0u16;
    const MANAGER_ROLE: u16 = 8u16; // can only assign roles
    mapping address_to_role: address => u16;

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

    struct ChecksumEdition {
        checksum: [u8; 32],
        edition: u16,
    }

    record TokenComplianceStateRecord {
        owner: address,
        cumulative_amount_per_epoch: u128,
        latest_block_height: u32
    }

    // Initializes the admin, and the the constant mappings used by off-chain parties: freeze_registry_program_name, threshold, epoch.
    // Can only be called once — ensures the contract has not already been initialized.    
    // Can be called only by the INITIAL_CONFIGURATION_ADDRESS
    async transition initialize(public admin: address, public blocks: u32) -> Future {
        return f_initialize(admin, self.caller, blocks);
    }
    async function f_initialize(admin: address, caller: address, blocks: u32) {
        let already_initialized: bool = freeze_registry_program_name.contains(FREEZE_REGISTRY_PROGRAM_INDEX);
        assert_eq(already_initialized, false);

        assert_eq(caller, INITIAL_CONFIGURATION_ADDRESS);

        address_to_role.set(admin, MANAGER_ROLE);

        freeze_registry_program_name.set(FREEZE_REGISTRY_PROGRAM_INDEX, FREEZE_REGISTRY_PROGRAM_NAME);
        threshold.set(THRESHOLD_INDEX, THRESHOLD);
        epoch.set(EPOCH_INDEX, EPOCH);

        block_height_window.set(BLOCK_HEIGHT_WINDOW_INDEX, blocks);
    }

    // Initializes a new TokenComplianceStateRecord for the signer.
    // Ensures the signer has not already registered.
    // Marks the signer as having an active compliance state record in owned_state_record mapping.
    async transition signup() -> (TokenComplianceStateRecord, Future){
        let state_record: TokenComplianceStateRecord = TokenComplianceStateRecord {
            owner: self.signer,
            cumulative_amount_per_epoch: 0u128,
            latest_block_height: 0u32
        };

        return (state_record, f_signup(self.signer));
    }
    async function f_signup(signer: address) {
        let is_owned_state_record: bool = owned_state_record.get_or_use(signer, false);
        assert_eq(is_owned_state_record, false);

        owned_state_record.set(signer, true);
    }

    // Initializes a new TokenComplianceStateRecord for the record owner.
    // Ensures the record owner has not already registered.
    // Marks the record owner as having an active compliance state record in owned_state_record mapping.
    // Transfers private tokens from the record owner to a recipient.
    // The user provides an estimated block height, used for cumulative amount calculation.
    // The estimated block height must be ≤ the current block height and ≥ (current block height − block_height_window).
    // If the cumulative amount exceeds the threshold, a ComplianceRecord is emitted for the investigator, who must match the stored role.
    // Both sender and recipient must not appear in the freeze list stored in freeze_registry.
    // The recipient's privacy is preserved by proving non-inclusion in the freeze list Merkle tree.
    // BE AWARE: This function will reveal the sender's address 
    async transition signup_and_transfer_private(        
        recipient: address,
        amount: u128,
        input_record: token_registry.aleo/Token,
        public estimated_block_height: u32,
        recipient_merkle_proofs: [MerkleProof;2]
    ) -> (ComplianceRecord, TokenComplianceStateRecord, token_registry.aleo/Token, token_registry.aleo/Token, Future) {
        assert_eq(input_record.token_id, TOKEN_ID);

        let verify_sender: Future = sealance_freezelist_registry.aleo/verify_non_inclusion_pub(input_record.owner);
        let verify_recipient: Future = sealance_freezelist_registry.aleo/verify_non_inclusion_priv(recipient, recipient_merkle_proofs);

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

        let state_record: TokenComplianceStateRecord = TokenComplianceStateRecord {
            owner: input_record.owner,
            cumulative_amount_per_epoch: amount,
            latest_block_height: estimated_block_height
        };

        let is_above_threshold: bool = amount > THRESHOLD;
        let compliance_record: ComplianceRecord = ComplianceRecord {
            owner: is_above_threshold ? INVESTIGATOR_ADDRESS : ZERO_ADDRESS,
            amount: is_above_threshold ? amount : 0u128,
            sender: is_above_threshold ? input_record.owner : ZERO_ADDRESS,
            recipient: is_above_threshold ? recipient : ZERO_ADDRESS,
        };

        return (            
            compliance_record,
            state_record,
            authorization_call.0, 
            transfer_call.1,
            f_signup_and_transfer_private(
                input_record.owner,
                estimated_block_height,
                verify_sender,
                verify_recipient,
                authorization_call.2,
                transfer_call.2
            ));
    }
    async function f_signup_and_transfer_private(
        sender: address,  
        estimated_block_height: u32,
        verify_sender: Future,
        verify_recipient: Future,  
        authorization_call: Future,
        transfer_call: Future
    ) {
        let is_owned_state_record: bool = owned_state_record.get_or_use(sender, false);
        assert_eq(is_owned_state_record, false);
        owned_state_record.set(sender, true);

        verify_sender.await();
        verify_recipient.await();

        assert(block.height >= estimated_block_height);
        let window: u32 = block_height_window.get(BLOCK_HEIGHT_WINDOW_INDEX);
        window = block.height > window 
            ? window
            : block.height;
        assert(estimated_block_height >= (block.height - window));

        authorization_call.await();
        transfer_call.await();
    }

    // Updates the number of blocks during which the previous root is still considered valid.
    // Can only be called by the admin.
    async transition update_block_height_window(public blocks: u32) -> Future {
        return f_update_block_height_window(blocks, self.caller);
    }
    async function f_update_block_height_window(blocks: u32, caller: address) {
        let role: u16 = address_to_role.get(caller);
        assert(role & MANAGER_ROLE == MANAGER_ROLE);

        block_height_window.set(BLOCK_HEIGHT_WINDOW_INDEX, blocks);
    }

    // Updates the address assigned to a given role.
    // Can only be called by the current role manager.
    async transition update_role(public new_address: address, role: u16) -> Future {
        return f_update_role(new_address, self.caller, role);
    }
    async function f_update_role(new_address: address, caller: address, new_role: u16) {
        let current_role: u16 = address_to_role.get(caller);
        assert(current_role & MANAGER_ROLE == MANAGER_ROLE);
        
        if (caller == new_address) { 
            assert(new_role & MANAGER_ROLE == MANAGER_ROLE); 
        }

        address_to_role.set(new_address, new_role);
    }

    // -------------------------
    // Called by token owners/DeFi contracts
    // -------------------------

    // Transfers public tokens from the caller to the recipient.
    // The caller must first approve this contract in the token_registry via the approve transition.
    // The caller must also first call signup or signup_and_transfer_private to create an initial compliance state record.
    // Generates a new TokenComplianceStateRecord that tracks the amount transferred in the current epoch.
    // The user provides an estimated block height, used for cumulative amount calculation.
    // The estimated block height must be ≤ the current block height and ≥ (current block height − block_height_window).
    // Both sender and recipient must not appear in the freeze list stored in freeze_registry.
    async transition transfer_public(
        public recipient: address,
        public amount: u128,
        input_state_record: TokenComplianceStateRecord,
        public estimated_block_height: u32,
    ) -> (TokenComplianceStateRecord, Future) {
        assert_eq(input_state_record.owner, self.caller);

        let verify_sender: Future = sealance_freezelist_registry.aleo/verify_non_inclusion_pub(self.caller);
        let verify_recipient: Future = sealance_freezelist_registry.aleo/verify_non_inclusion_pub(recipient);

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

        return (state_record, finalize_transfer_public(verify_sender, verify_recipient, authorization_call, transfer_call, estimated_block_height));
    }
    async function finalize_transfer_public(
        verify_sender: Future,
        verify_recipient: Future,
        authorization_call: Future,
        transfer_call: Future,
        estimated_block_height: u32
    ) {
        verify_sender.await();
        verify_recipient.await();

        assert(block.height >= estimated_block_height);
        let window: u32 = block_height_window.get(BLOCK_HEIGHT_WINDOW_INDEX);
        window = block.height > window 
            ? window
            : block.height;
        assert(estimated_block_height >= (block.height - window));

        authorization_call.await();
        transfer_call.await();
    }

    // Transfers public tokens from the signer to the recipient.
    // The signer must also first call signup or signup_and_transfer_private to create an initial compliance state record.
    // Generates a new TokenComplianceStateRecord that tracks the amount transferred in the current epoch.
    // The user provides an estimated block height, used for cumulative amount calculation.
    // The estimated block height must be ≤ the current block height and ≥ (current block height − block_height_window).
    // Both sender and recipient must not appear in the freeze list stored in freeze_registry.
    async transition transfer_public_as_signer(
        public recipient: address,
        public amount: u128,
        input_state_record: TokenComplianceStateRecord,
        public estimated_block_height: u32,
    ) -> (TokenComplianceStateRecord, Future) {
        let verify_sender: Future = sealance_freezelist_registry.aleo/verify_non_inclusion_pub(self.signer);
        let verify_recipient: Future = sealance_freezelist_registry.aleo/verify_non_inclusion_pub(recipient);

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

        return (state_record, f_transfer_public_as_signer(verify_sender, verify_recipient, authorization_call, transfer_call, estimated_block_height));
    }
    async function f_transfer_public_as_signer(
        verify_sender: Future,
        verify_recipient: Future,
        authorization_call: Future,
        transfer_call: Future,
        estimated_block_height: u32
    ) {
        verify_sender.await();
        verify_recipient.await();

        assert(block.height >= estimated_block_height);
        let window: u32 = block_height_window.get(BLOCK_HEIGHT_WINDOW_INDEX);
        window = block.height > window 
            ? window
            : block.height;
        assert(estimated_block_height >= (block.height - window));

        authorization_call.await();
        transfer_call.await();
    }

    // Transfers public tokens from the caller to a recipient as a private token.
    // The caller must first approve this contract in the token_registry via the approve transition.
    // The caller must also first call signup or signup_and_transfer_private to create an initial compliance state record.
    // Generates a new TokenComplianceStateRecord that tracks the amount transferred in the current epoch.
    // The user provides an estimated block height, used for cumulative amount calculation.
    // The estimated block height must be ≤ the current block height and ≥ (current block height − block_height_window).
    // If the cumulative amount exceeds the threshold, a ComplianceRecord is emitted for the investigator, who must match the stored role.
    // Both sender and recipient must not appear in the freeze list stored in freeze_registry.
    // The recipient's privacy is preserved by proving non-inclusion in the freeze list Merkle tree.
    async transition transfer_public_to_priv(
        recipient: address,
        public amount: u128,
        input_state_record: TokenComplianceStateRecord,
        public estimated_block_height: u32,
        recipient_merkle_proofs: [MerkleProof;2]
    ) -> (ComplianceRecord, TokenComplianceStateRecord, token_registry.aleo/Token, Future) {
        assert_eq(input_state_record.owner, self.caller);

        let verify_sender: Future = sealance_freezelist_registry.aleo/verify_non_inclusion_pub(self.caller);
        let verify_recipient: Future = sealance_freezelist_registry.aleo/verify_non_inclusion_priv(recipient, recipient_merkle_proofs);
        
        let owner: TokenOwner = TokenOwner {
            account: self.caller,
            token_id: TOKEN_ID
        };

        let authorization_call: Future = token_registry.aleo/prehook_public(
            owner,
            amount,
            AUTHORIZED_UNTIL
        );

        let transfer_call: (token_registry.aleo/Token, Future) = token_registry.aleo/transfer_from_public_to_private(
            TOKEN_ID,
            self.caller,
            recipient,
            amount,
            true
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
            owner: is_above_threshold ? INVESTIGATOR_ADDRESS : ZERO_ADDRESS,
            amount: is_above_threshold ? amount : 0u128,
            sender: is_above_threshold ? sender : ZERO_ADDRESS,
            recipient: is_above_threshold ? recipient : ZERO_ADDRESS,
        };

        return (
            compliance_record,
            state_record, 
            transfer_call.0, 
            f_transfer_public_to_priv(
                verify_sender,
                verify_recipient,
                authorization_call,
                transfer_call.1, 
                estimated_block_height
            )
        );
    }
    async function f_transfer_public_to_priv(
        verify_sender: Future,
        verify_recipient: Future,
        authorization_call: Future,
        transfer_call: Future,
        estimated_block_height: u32
    ) {
        verify_sender.await();
        verify_recipient.await();

        assert(block.height >= estimated_block_height);
        let window: u32 = block_height_window.get(BLOCK_HEIGHT_WINDOW_INDEX);
        window = block.height > window 
            ? window
            : block.height;
        assert(estimated_block_height >= (block.height - window));

        authorization_call.await();
        transfer_call.await();
    }

    // Transfers private tokens from the record owner to a recipient.
    // The record owner must also first call signup or signup_and_transfer_private to create an initial compliance state record.
    // Generates a new TokenComplianceStateRecord that tracks the amount transferred in the current epoch.
    // The user provides an estimated block height, used for cumulative amount calculation.
    // The estimated block height must be ≤ the current block height and ≥ (current block height − block_height_window).
    // If the cumulative amount exceeds the threshold, a ComplianceRecord is emitted for the investigator, who must match the stored role.
    // Both sender and recipient must not appear in the freeze list stored in freeze_registry.
    // The sender's and recipient's privacy is preserved by proving non-inclusion in the freeze list Merkle tree.
    async transition transfer_private(
        recipient: address,
        amount: u128,
        input_record: token_registry.aleo/Token,
        input_state_record: TokenComplianceStateRecord,
        public estimated_block_height: u32,
        sender_merkle_proofs: [MerkleProof;2],
        recipient_merkle_proofs: [MerkleProof;2]
    ) -> (ComplianceRecord, TokenComplianceStateRecord, token_registry.aleo/Token, token_registry.aleo/Token, Future) {
        assert_eq(input_record.token_id, TOKEN_ID);

        let verify_sender: Future = sealance_freezelist_registry.aleo/verify_non_inclusion_priv(input_record.owner, sender_merkle_proofs);
        let verify_recipient: Future = sealance_freezelist_registry.aleo/verify_non_inclusion_priv(recipient, recipient_merkle_proofs);

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
            owner: is_above_threshold ? INVESTIGATOR_ADDRESS : ZERO_ADDRESS,
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
                estimated_block_height
            )
        );
    }

    async function f_transfer_private(
        verify_sender: Future,
        verify_recipient: Future,  
        authorization_call: Future,
        transfer_call: Future,       
        estimated_block_height: u32
    ) {
        verify_sender.await();
        verify_recipient.await();

        assert(block.height >= estimated_block_height);
        let window: u32 = block_height_window.get(BLOCK_HEIGHT_WINDOW_INDEX);
        window = block.height > window 
            ? window
            : block.height;
        assert(estimated_block_height >= (block.height - window));

        authorization_call.await();
        transfer_call.await();
    }

    // Transfers private tokens from the record owner to a recipient as a public tokens.
    // The record owner must also first call signup or signup_and_transfer_private to create an initial compliance state record.
    // Generates a new TokenComplianceStateRecord that tracks the amount transferred in the current epoch.
    // The user provides an estimated block height, used for cumulative amount calculation.
    // The estimated block height must be ≤ the current block height and ≥ (current block height − block_height_window).
    // If the cumulative amount exceeds the threshold, a ComplianceRecord is emitted for the investigator, who must match the stored role.
    // Both sender and recipient must not appear in the freeze list stored in freeze_registry.
    // The sender's and recipient's privacy is preserved by proving non-inclusion in the freeze list Merkle tree.
    async transition transfer_priv_to_public(
        public recipient: address,
        public amount: u128,
        input_record: token_registry.aleo/Token,
        input_state_record: TokenComplianceStateRecord,
        public estimated_block_height: u32,
        sender_merkle_proofs: [MerkleProof; 2],
    ) -> (ComplianceRecord, TokenComplianceStateRecord, token_registry.aleo/Token, Future) {
        assert_eq(input_record.token_id, TOKEN_ID);
        
        let verify_sender: Future = sealance_freezelist_registry.aleo/verify_non_inclusion_priv(input_record.owner, sender_merkle_proofs);
        let verify_recipient: Future = sealance_freezelist_registry.aleo/verify_non_inclusion_pub(recipient);

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
            owner: is_above_threshold ? INVESTIGATOR_ADDRESS : ZERO_ADDRESS,
            amount: is_above_threshold ? amount : 0u128,
            sender: is_above_threshold ? input_record.owner : ZERO_ADDRESS,
            recipient: is_above_threshold ? recipient : ZERO_ADDRESS,
        };
        
        return (
            compliance_record, 
            state_record,
            authorization_call.0,
            f_transfer_priv_to_public(
                verify_sender,
                verify_recipient,
                authorization_call.2, 
                transfer_call.1, 
                estimated_block_height
            )
        );
    }

    async function f_transfer_priv_to_public(
        verify_sender: Future,
        verify_recipient: Future,
        authorization_call: Future,
        transfer_call: Future,
        estimated_block_height: u32
    ) {
        verify_sender.await();
        verify_recipient.await();

        assert(block.height >= estimated_block_height);
        let window: u32 = block_height_window.get(BLOCK_HEIGHT_WINDOW_INDEX);
        window = block.height > window 
            ? window
            : block.height;
        assert(estimated_block_height >= (block.height - window));

        authorization_call.await();
        transfer_call.await();
    }
}