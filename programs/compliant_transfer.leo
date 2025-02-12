import token_registry.aleo;

// The 'compliant_transfer' program.
program compliant_transfer.aleo {
    const TOKEN_ID: field = 4846247369341682005field;

    const ADMIN: address = aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px;
    const INVESTIGATOR: address = aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t;
    const ZERO_ADDRESS: address = aleo1ashyu96tjwe63u0gtnnv8z5lhapdu4l5pjsl2kha7fv7hvz2eqxs5dz0rg;
    const PROGRAM_ADDRESS: address = aleo1pxzpcyznucwdtuqzfrksk3uxvjkkvadx5wc3cp3jvshyfex0muzspvdzw3;
    
    const NAME: u128 = 4846247369341682005u128; // name: u128, CATNOHAT ascii encoded
    const SYMBOL: u128 = 4846247369341682005u128; // symbol: u128, CATNOHAT ascii encoded
    const DECIMALS: u8 = 6u8; // symbol: u128, CATNOHAT ascii encoded
    const TOTAL_SUPPLY: u128 = 1_000_000_000_000_000u128;
    const FAUCET_AMOUNT: u128 = 100_000u128;
    const AUTHORIZED_UNTIL: u32 = 4294967295u32;

    mapping freeze_list: address => bool;
    mapping funded: address => bool;

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


    async transition initialize() -> Future {
        let token_registry_call: Future = token_registry.aleo/register_token(
            TOKEN_ID,
            4846247369341682005u128, // name: u128, CATNOHAT ascii encoded
            4846247369341682005u128, // symbol: u128, CATNOHAT ascii encoded
            6u8, // decimals: u8
            1_000_000_000_000_000u128, // max_supply: u128
            true,
            PROGRAM_ADDRESS // external_authorization_party: address
        );
        return finalize_initialize(token_registry_call, self.caller );
    }
    
    async function finalize_initialize(token_registry_call: Future, caller: address) {
        assert_eq(caller, ADMIN);
        token_registry_call.await();
    }

    async transition update_freeze_list(account: address, is_freezed: bool) -> Future {
        return f_update_freeze_list(account, is_freezed, self.caller);
    }

    async function f_update_freeze_list(account: address, is_freezed: bool, caller: address) {
        assert_eq(ADMIN, caller);
        freeze_list.set(account, is_freezed);
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



    // async transition transfer_from_public(
    //     public owner: address,
    //     public recipient: address,
    //     public amount: u128
    // ) -> Future {
    //     let token_registry_call: Future = token_registry.aleo/transfer_from_public(
    //         TOKEN_ID,
    //         owner,
    //         recipient,
    //         amount
    //     );
    //     return finalize_transfer_from_public(token_registry_call, owner, recipient);
    // }

    // async function finalize_transfer_from_public(
    //     token_registry_call: Future,
    //     sender: address,
    //     recipient: address
    // ) {
    //     let is_sender_freezed: bool = freeze_list.get_or_use(sender, false);
    //     assert_eq(is_sender_freezed, false);
    //     let is_recipient_freezed: bool = freeze_list.get_or_use(recipient, false);
    //     assert_eq(is_recipient_freezed, false);
    //     token_registry_call.await();
    // }

    async transition transfer_public_to_priv(
        recipient: address,
        public amount: u128,
    ) -> (ComplianceRecord, token_registry.aleo/Token, Future) {
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
                self.caller
            )
        );
    }

    async function f_transfer_public_to_priv(
        authorization_call_for_caller: Future,
        transfer_to_program: Future,
        authorization_call_for_program: Future,
        transfer_to_recipient: Future,
        sender: address
    ) {
        let is_sender_freezed: bool = freeze_list.get_or_use(sender, false);
        assert_eq(is_sender_freezed, false);

        authorization_call_for_caller.await();
        transfer_to_program.await();
        authorization_call_for_program.await();
        transfer_to_recipient.await();
    }

    // async transition transfer_from_public_to_priv(
    //     public owner: address,
    //     recipient: address,
    //     public amount: u128,
    //     public external_authorization_required: bool
    // ) -> (ComplianceRecord, token_registry.aleo/Token, Future) {
    //     let token_registry_call: (token_registry.aleo/Token, Future) = token_registry.aleo/transfer_from_public_to_priv(
    //         TOKEN_ID,
    //         owner,
    //         recipient,
    //         amount,
    //         external_authorization_required,
    //     );


    //     let compliance_record: ComplianceRecord = ComplianceRecord {
    //         owner: INVESTIGATOR,
    //         amount: amount,
    //         sender: owner,
    //         recipient: recipient,
    //     };

    //     return (compliance_record, token_registry_call.0, f_transfer_from_public_to_priv(token_registry_call.1, owner));
    // }

    // async function f_transfer_from_public_to_priv(
    //     token_registry_call: Future,
    //     sender: address
    // ) {
    //     let is_sender_freezed: bool = freeze_list.get_or_use(sender, false);
    //     assert_eq(is_sender_freezed, false);
    //     token_registry_call.await();
    // }

    async transition transfer_private(
        recipient: address,
        amount: u128,
        input_record: token_registry.aleo/Token
    ) -> (ComplianceRecord, token_registry.aleo/Token, token_registry.aleo/Token, Future) {

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
            finalize_transfer_private(
                authorization_call.2,
                transfer_call.2
            )
        );
    }

    async function finalize_transfer_private(
        authorization_call: Future,
        transfer_call: Future
    ) {
        authorization_call.await();
        transfer_call.await();
    }

    async transition transfer_priv_to_public(
        public recipient: address,
        public amount: u128,
        input_record: token_registry.aleo/Token
    ) -> (ComplianceRecord, token_registry.aleo/Token, Future) {
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
                recipient
            )
        );
    }

    async function f_transfer_priv_to_public(
        authorization_call: Future,
        transfer_call: Future,
        recipient: address
    ) {
        let is_recipient_freezed: bool = freeze_list.get_or_use(recipient, false);
        assert_eq(is_recipient_freezed, false);

        authorization_call.await();
        transfer_call.await();

    }
}