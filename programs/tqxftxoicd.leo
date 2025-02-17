import token_registry.aleo;
import rediwsozfo.aleo;

program tqxftxoicd.aleo {

    const TOKEN_ID: field = 100667890849571067315045710field; // SEALEDTOKEN ascii encoded
    const ADMIN: address = aleo17skrjdgtsy7krfpddjzd83c9kzs3elxlffgmhjj795dduy78vuxs9c4jgp;
    const INVESTIGATOR: address = aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t;
    // ZERO_ADDRESS as field equals to 0field
    const ZERO_ADDRESS: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;
    const PROGRAM_ADDRESS: address = aleo10ha27yxrya7d7lf0eg5p3hqcafm8k6nj00pvgeuxuqmvhqpst5xsdh2ft4;
    
    const NAME: u128 = 100667890849571067315045710u128; // name: u128, SEALEDTOKEN ascii encoded
    const SYMBOL: u128 = 1397047628u128; // symbol: u128, SEAL ascii encoded
    const DECIMALS: u8 = 6u8;
    const TOTAL_SUPPLY: u128 = 1_000_000_000_000_000u128;
    const FAUCET_AMOUNT: u128 = 100_000u128;
    const AUTHORIZED_UNTIL: u32 = 4294967295u32;

    // Mappings
    mapping freeze_list: address => bool;
    mapping funded: address => bool;
    mapping merkle_root: u8 => field;

    /* FLOWS

    ADMIN to update the list:
        1. (offchain) get the current list
        2. add/remove a new address
        3. sort the leaves
        4. (chain) update the mapping -> update root

    ADMIN to add/remove address:
        1. (offchain) get the current list 
        2. add/remove a new address
        3. sort the leaves
        4. (chain) build a new tree
        4. (chain) add_address/remove_address updating tree_address mapping and update the root 

    USER to generate a proof:
        1. (offchain) get the current leaves
        2. (chain) build tree
        3. find the closest leaf to the own address
        4. (chain) compute siblings paths for left leaf
        5. (chain) compute siblings paths for right leaf
        5. (chain) verify non inclusion proof
    */

    struct MerkleProof {
        siblings: [field; 4],
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

    async transition update_freeze_list(account: address, is_freezed: bool, new_root: field) -> Future {
        return f_update_freeze_list(account, is_freezed, self.caller, new_root);
    }
    async function f_update_freeze_list(account: address, is_freezed: bool, caller: address, new_root: field) {
        assert_eq(ADMIN, caller);
        freeze_list.set(account, is_freezed);
        merkle_root.set(0u8, new_root);
    }

    async transition demo_faucet() -> (ComplianceRecord, token_registry.aleo/Token, Future) {
        let mint_public_call: Future = token_registry.aleo/mint_public(
            TOKEN_ID,
            self.caller,
            FAUCET_AMOUNT,
            AUTHORIZED_UNTIL
        );
        
        let mint_private_call: (token_registry.aleo/Token, Future) = token_registry.aleo/mint_private(
            TOKEN_ID,
            self.caller,
            FAUCET_AMOUNT,
            true,
            0u32
        );

        let compliance_record: ComplianceRecord = ComplianceRecord {
            owner: INVESTIGATOR,
            amount: FAUCET_AMOUNT,
            sender: ZERO_ADDRESS,
            recipient: self.caller
        };
        
        return (compliance_record, mint_private_call.0, finalize_demo_faucet(mint_public_call, mint_private_call.1, self.caller));
    }

    async function finalize_demo_faucet(
        mint_public_call: Future,
        mint_private_call: Future,
        recipient: address
    ) {
        let is_funded: bool = funded.get_or_use(recipient, false);
        assert_eq(is_funded, false);
        funded.set(recipient, true);

        mint_public_call.await();
        mint_private_call.await();
    }

async transition mint_public(
        public recipient: address,
        public amount: u128,
    ) -> Future {
        let token_registry_call: Future = token_registry.aleo/mint_public(
            TOKEN_ID,
            recipient,
            amount,
            AUTHORIZED_UNTIL
        );
        return finalize_mint_public(token_registry_call, self.caller);
    }

    async function finalize_mint_public(
        token_registry_call: Future,
        caller: address
    ) {
        assert_eq(ADMIN, caller);
        token_registry_call.await();
    }

    async transition mint_private(
        recipient: address,
        public amount: u128,
    ) -> (ComplianceRecord, token_registry.aleo/Token, Future) {
        let token_registry_call: (token_registry.aleo/Token, Future) = token_registry.aleo/mint_private(
            TOKEN_ID,
            recipient,
            amount,
            true,
            0u32
        );

        let compliance_record: ComplianceRecord = ComplianceRecord {
            owner: INVESTIGATOR,
            amount: amount,
            sender: ZERO_ADDRESS,
            recipient: recipient
        };

        return (compliance_record, token_registry_call.0, finalize_mint_private(token_registry_call.1, self.caller));
    }

    async function finalize_mint_private(
        token_registry_call: Future,
        caller: address
    ) {
        assert_eq(ADMIN, caller);
        token_registry_call.await();
    }

    async transition burn_public(
        public owner: address,
        public amount: u128
    ) -> Future {
        let token_registry_call: Future = token_registry.aleo/burn_public(
            TOKEN_ID,
            owner,
            amount
        );

        return finalize_burn_public(token_registry_call, self.caller);
    }

    async function finalize_burn_public(
        token_registry_call: Future,
        caller: address
    ) {
        assert_eq(ADMIN, caller);
        token_registry_call.await();
    }

    async transition burn_private(
        // is it possible to burn records of other users?
        input_record: token_registry.aleo/Token,
        public amount: u128
    ) -> (ComplianceRecord, token_registry.aleo/Token, Future) {
        let token_registry_call: (token_registry.aleo/Token , Future) = token_registry.aleo/burn_private(
            input_record,
            amount,
        );

        let compliance_record: ComplianceRecord = ComplianceRecord {
            owner: INVESTIGATOR,
            amount: amount,
            sender: input_record.owner,
            recipient: ZERO_ADDRESS,
        };
        return (compliance_record, token_registry_call.0, finalize_burn_private(token_registry_call.1, self.caller));
    }

    async function finalize_burn_private(
        token_registry_call: Future,
        caller: address
    ) {
        assert_eq(ADMIN, caller);
        token_registry_call.await(); 
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
    ) -> (ComplianceRecord, token_registry.aleo/Token, Future) {
        let root: field = rediwsozfo.aleo/verify_non_inclusion(recipient, recipient_merkle_proofs);

        let owner: TokenOwner = TokenOwner {
            account: self.caller, // it should be the signer if we choose option 2
            token_id: TOKEN_ID
        };

        let authorization_call_for_caller: Future = token_registry.aleo/prehook_public(
            owner,
            amount,
            AUTHORIZED_UNTIL
        );

        /*option 1 - the sender is the caller and the caller needs to approve the program */
        let transfer_to_program: Future = token_registry.aleo/transfer_from_public(
            TOKEN_ID,
            self.caller,
            PROGRAM_ADDRESS,
            amount,
        );

        /* option 2 - the sender is the signer and no one need to approve the program*/
        // let token_registry_call: (token_registry.aleo/Token, Future) = token_registry.aleo/transfer_public_as_signer(
        //     TOKEN_ID,
        //     PROGRAM_ADDRESS,
        //     amount,
        // );

        let program_owner: TokenOwner = TokenOwner {
            account: PROGRAM_ADDRESS, // it should be the signer if we choose option 2
            token_id: TOKEN_ID
        };

        let authorization_call_for_program: Future = token_registry.aleo/prehook_public(
            program_owner,
            amount,
            AUTHORIZED_UNTIL
        );

        let transfer_to_recipient: (token_registry.aleo/Token, Future) = token_registry.aleo/transfer_public_to_priv(
            TOKEN_ID,
            recipient,
            amount,
            true,
        );

        let compliance_record: ComplianceRecord = ComplianceRecord {
            owner: INVESTIGATOR,
            amount: amount,
            sender: self.caller, // maybe it should be the self.signer
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
                root
            )
        );
    }
    async function f_transfer_public_to_priv(
        authorization_call_for_caller: Future,
        transfer_to_program: Future,
        authorization_call_for_program: Future,
        transfer_to_recipient: Future,
        sender: address,
        root: field
    ) {
        let is_sender_freezed: bool = freeze_list.get_or_use(sender, false);
        assert_eq(is_sender_freezed, false);

        let current_root: field = merkle_root.get(0u8);
        assert_eq(root, current_root);

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
            owner: INVESTIGATOR,
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
            )
        );
    }

    async function f_transfer_private(
        authorization_call: Future,
        transfer_call: Future,
        root: field
    ) {
        let current_root: field = merkle_root.get(0u8);
        assert_eq(root, current_root);
        
        authorization_call.await();
        transfer_call.await();
    }

        async transition transfer_priv_to_public(
        public recipient: address,
        public amount: u128,
        input_record: token_registry.aleo/Token,
        sender_merkle_proofs: [MerkleProof; 2]
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
        let transfer_call: (token_registry.aleo/Token, Future) = token_registry.aleo/transfer_priv_to_public(
            recipient,
            amount,
            authorization_call.1,
        );
        
        let compliance_record: ComplianceRecord = ComplianceRecord {
            owner: INVESTIGATOR,
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
                root
            )
        );
    }
    async function f_transfer_priv_to_public(
        authorization_call: Future,
        transfer_call: Future,
        recipient: address,
        root: field
    ) {
        let is_recipient_freezed: bool = freeze_list.get_or_use(recipient, false);
        assert_eq(is_recipient_freezed, false);
       
        let current_root: field = merkle_root.get(0u8);
        assert_eq(root, current_root);
        
        authorization_call.await();
        transfer_call.await();
    }
}