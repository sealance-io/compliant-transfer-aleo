import token_registry.aleo;
import sealance_freezelist_registry.aleo;

program sealed_timelock_policy.aleo {

    const TOKEN_ID: field = 31155203188273609789785737924444174490841009372087129field; // TIMELOCK ascii encoded
    const NAME: u128 = 1709529976692281403789758276781390u128; // name: u128, TIMELOCK_TOKEN ascii encoded
    const SYMBOL: u128 = 6073470532514169675u128; // symbol: u128, TIMELOCK ascii encoded
    const DECIMALS: u8 = 6u8;
    const TOTAL_SUPPLY: u128 = 1_000_000_000_000_000u128;
    const PROGRAM_ADDRESS: address = aleo1q40dlwxfgka53c3wt5ef5k0yvf06dksgcrkdc0r20xpky0ezwqrqpzggeq;
    const AUTHORIZED_UNTIL: u32 = 4294967295u32;
    const FREEZE_REGISTRY_PROGRAM_NAME: u128 = 531934507715736310883939492834865785u128;// freeze_registry ascii encoded

    // Mappings
    mapping freeze_registry_program_name: u8 => u128;

    const ADMIN_ROLE: u8 = 1u8;
    const MINTER_ROLE: u8 = 2u8;
    mapping roles: address => u8;

    struct MerkleProof {
        siblings: [field; 16],
        leaf_index: u32
    }

    record CompliantToken {
        owner: address,
        amount: u128,
        locked_until: u32
    } 

    struct TokenOwner {
        account: address,
        token_id: field
    }

    // -------------------------
    // Called by administrators
    // -------------------------

    async transition initialize() -> Future {
        // Set admin and external_authorization_party to be PROGRAM_ADDRESS
        let token_registry_call: Future = token_registry.aleo/register_token(
            TOKEN_ID,
            NAME,
            SYMBOL,
            DECIMALS,
            TOTAL_SUPPLY,
            true,
            PROGRAM_ADDRESS // external_authorization_party: address
        );
        return f_initialize(token_registry_call, self.caller );
    }

    async function f_initialize(token_registry_call: Future, caller: address,) {
        freeze_registry_program_name.set(0u8, FREEZE_REGISTRY_PROGRAM_NAME);
        roles.set(caller, ADMIN_ROLE);
        
        token_registry_call.await();
    }

    async transition update_roles(public new_address: address, public role: u8) -> Future {
        return f_update_roles(new_address, self.caller, role);
    }
    async function f_update_roles(new_address: address, caller: address, role: u8) {
        let caller_role: u8 = roles.get(caller);
        assert_eq(caller_role, ADMIN_ROLE);
        roles.set(new_address, role);
    }

    async transition mint_public(
        public recipient: address,
        public amount: u128,
        lock_until: u32
    ) -> (CompliantToken, Future) {
        let token_registry_call: Future = token_registry.aleo/mint_public(
            TOKEN_ID,
            recipient,
            amount,
            0u32
        );

        let authorized_record: CompliantToken = CompliantToken {
            owner: recipient,
            amount: amount,
            locked_until: lock_until
        };

        return (authorized_record, finalize_mint_public(token_registry_call, self.caller));
    }

    async function finalize_mint_public(
        token_registry_call: Future,
        caller: address
    ) {
        let role: u8 = roles.get(caller);
        assert(role == MINTER_ROLE || role == ADMIN_ROLE);

        token_registry_call.await();
    }

    async transition mint_private(
        recipient: address,
        public amount: u128,
        lock_until: u32
    ) -> (CompliantToken, token_registry.aleo/Token, Future) {
        let token_registry_call: (token_registry.aleo/Token, Future) = token_registry.aleo/mint_private(
            TOKEN_ID,
            recipient,
            amount,
            true,
            0u32
        );

        let authorized_record: CompliantToken = CompliantToken {
            owner: recipient,
            amount: amount,
            locked_until: lock_until
        };

        return (authorized_record, token_registry_call.0, finalize_mint_private(token_registry_call.1, self.caller));
    }

    async function finalize_mint_private(
        token_registry_call: Future,
        caller: address
    ) {
        let role: u8 = roles.get(caller);
        assert(role == MINTER_ROLE || role == ADMIN_ROLE);

        token_registry_call.await();
    }

    // -------------------------
    // Called by token owners/DeFi contracts
    // -------------------------

    // The caller has to approve this contract to call this function
    async transition transfer_public(
        public recipient: address,
        public amount: u128,
        sealed_token: CompliantToken,
        lock_until: u32,
    ) -> (CompliantToken, CompliantToken, Future) {

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

        let unauthorized_record: CompliantToken = CompliantToken {
            owner: sealed_token.owner,
            amount: sealed_token.amount - amount,
            locked_until: sealed_token.locked_until
        };

        let authorized_record: CompliantToken = CompliantToken {
            owner: recipient,
            amount: amount,
            locked_until: lock_until
        };

        return (
            unauthorized_record,
            authorized_record, 
            finalize_transfer_public(sealed_token.locked_until, authorization_call, transfer_call, verify_sender, verify_recipient)
            );
    }

    async function finalize_transfer_public(
        locked_until: u32, 
        verify_sender: Future,
        verify_recipient: Future,
        authorization_call: Future,
        transfer_call: Future
    ) {
        verify_sender.await();
        verify_recipient.await();

        authorization_call.await(); 
        transfer_call.await();

        assert(locked_until <= block.height);
  }

    async transition transfer_public_as_signer(
        public recipient: address,
        public amount: u128,
        sealed_token: CompliantToken,
        lock_until: u32
    ) -> (CompliantToken, CompliantToken, Future) {
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

        let unauthorized_record: CompliantToken = CompliantToken {
            owner: sealed_token.owner,
            amount: sealed_token.amount - amount,
            locked_until: sealed_token.locked_until
        };

        let authorized_record: CompliantToken = CompliantToken {
            owner: recipient,
            amount: amount,
            locked_until: lock_until
        };

        return (
            unauthorized_record,
            authorized_record, 
            f_transfer_public_as_signer(sealed_token.locked_until, authorization_call, transfer_call, verify_sender, verify_recipient)
        );
    }

    async function f_transfer_public_as_signer(
        locked_until: u32,
        verify_sender: Future,
        verify_recipient: Future,
        authorization_call: Future,
        transfer_call: Future
    ) {
        verify_sender.await();
        verify_recipient.await();

        authorization_call.await();
        transfer_call.await();

        assert(locked_until <= block.height);
    }

    async transition transfer_public_to_priv(
        recipient: address,
        public amount: u128,
        recipient_merkle_proofs: [MerkleProof;2],
        sealed_token: CompliantToken,
        lock_until: u32
    ) -> (CompliantToken, CompliantToken, token_registry.aleo/Token, Future) {
        let verify_sender: Future = sealance_freezelist_registry.aleo/verify_non_inclusion_pub(self.caller);
        let verify_recipient: Future = sealance_freezelist_registry.aleo/verify_non_inclusion_priv(recipient, recipient_merkle_proofs);
        
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

        let unauthorized_record: CompliantToken = CompliantToken {
            owner: sealed_token.owner,
            amount: sealed_token.amount - amount,
            locked_until: sealed_token.locked_until
        };

        let authorized_record: CompliantToken = CompliantToken {
            owner: recipient,
            amount: amount,
            locked_until: lock_until
        };

        return (
            unauthorized_record,
            authorized_record,
            transfer_to_recipient.0, 
            f_transfer_public_to_priv(
                sealed_token.locked_until,
                verify_sender,
                verify_recipient,
                authorization_call_for_caller,
                transfer_to_program,
                authorization_call_for_program, 
                transfer_to_recipient.1, 
            )
        );
    }
    async function f_transfer_public_to_priv(
        locked_until: u32,
        verify_sender: Future,
        verify_recipient: Future,
        authorization_call_for_caller: Future,
        transfer_to_program: Future,
        authorization_call_for_program: Future,
        transfer_to_recipient: Future,
    ) {
        verify_sender.await();
        verify_recipient.await();

        authorization_call_for_caller.await();
        transfer_to_program.await();
        authorization_call_for_program.await();
        transfer_to_recipient.await();

        assert(locked_until <= block.height);
    }

    async transition transfer_private(
        recipient: address,
        amount: u128,
        sealed_token: CompliantToken,
        base_token: token_registry.aleo/Token,
        sender_merkle_proofs: [MerkleProof;2],
        recipient_merkle_proofs: [MerkleProof;2],
        lock_until: u32,
    ) -> (CompliantToken, CompliantToken, token_registry.aleo/Token, token_registry.aleo/Token, Future) {
        assert_eq(base_token.token_id, TOKEN_ID);
        assert_eq(base_token.amount, sealed_token.amount);

        let verify_sender: Future = sealance_freezelist_registry.aleo/verify_non_inclusion_priv(base_token.owner, sender_merkle_proofs);
        let verify_recipient: Future = sealance_freezelist_registry.aleo/verify_non_inclusion_priv(recipient, recipient_merkle_proofs);

        let authorization_call: (
            token_registry.aleo/Token, // unauthorized_record
            token_registry.aleo/Token, // authorized_record
            Future
        ) = token_registry.aleo/prehook_private(
            base_token, 
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

        let unauthorized_record: CompliantToken = CompliantToken {
            owner: sealed_token.owner,
            amount: sealed_token.amount - amount,
            locked_until: sealed_token.locked_until
        };

        let authorized_record: CompliantToken = CompliantToken {
            owner: recipient,
            amount: amount,
            locked_until: lock_until
        };

        return (
            unauthorized_record,
            authorized_record,
            authorization_call.0, 
            transfer_call.1, 
            f_transfer_private(
                sealed_token.locked_until,
                verify_sender,
                verify_recipient,
                authorization_call.2,
                transfer_call.2,
            )
        );
    }

    async function f_transfer_private(
        locked_until: u32,
        verify_sender: Future,
        verify_recipient: Future,  
        authorization_call: Future,
        transfer_call: Future,       
    ) {
        verify_sender.await();
        verify_recipient.await();
        authorization_call.await();
        transfer_call.await();

        assert(locked_until <= block.height);
    }

    async transition transfer_priv_to_public(
        public recipient: address,
        public amount: u128,
        sealed_token: CompliantToken,
        base_token: token_registry.aleo/Token,
        sender_merkle_proofs: [MerkleProof; 2],
        lock_until: u32,
    ) -> (CompliantToken, CompliantToken, token_registry.aleo/Token, Future) {
        assert_eq(base_token.token_id, TOKEN_ID);
        assert_eq(base_token.amount, sealed_token.amount);

        let verify_sender: Future = sealance_freezelist_registry.aleo/verify_non_inclusion_priv(base_token.owner, sender_merkle_proofs);
        let verify_recipient: Future = sealance_freezelist_registry.aleo/verify_non_inclusion_pub(recipient);

        let authorization_call: (
            token_registry.aleo/Token, // unauthorized_record
            token_registry.aleo/Token, // authorized_record
            Future
        ) = token_registry.aleo/prehook_private(
            base_token, 
            amount, 
            AUTHORIZED_UNTIL
        );

        // we don't need to return the record because the amount is zero
        let transfer_call: (token_registry.aleo/Token, Future) = token_registry.aleo/transfer_private_to_public(
            recipient,
            amount,
            authorization_call.1,
        );
        
        let unauthorized_record: CompliantToken = CompliantToken {
            owner: sealed_token.owner,
            amount: sealed_token.amount - amount,
            locked_until: sealed_token.locked_until
        };

        let authorized_record: CompliantToken = CompliantToken {
            owner: recipient,
            amount: amount,
            locked_until: lock_until
        };

        return (
            unauthorized_record,
            authorized_record,
            authorization_call.0,
            f_transfer_priv_to_public(
                sealed_token.locked_until,
                authorization_call.2, 
                transfer_call.1, 
                verify_sender,
                verify_recipient,
            )
        );
    }
    async function f_transfer_priv_to_public(
        locked_until: u32,
        verify_sender: Future,
        verify_recipient: Future,
        authorization_call: Future,
        transfer_call: Future,
    ) {
        verify_sender.await();
        verify_recipient.await();

        authorization_call.await();
        transfer_call.await();

        assert(locked_until <= block.height);
    }

    transition join(
        sealed_token_1: CompliantToken,
        base_token_1: token_registry.aleo/Token,
        sealed_token_2: CompliantToken,
        base_token_2: token_registry.aleo/Token
    ) -> (CompliantToken, token_registry.aleo/Token) {
        assert_eq(base_token_1.token_id, TOKEN_ID);
        assert_eq(base_token_2.token_id, TOKEN_ID);

        assert_eq(base_token_1.amount, sealed_token_1.amount);
        assert_eq(base_token_2.amount, sealed_token_2.amount);

        let locked_unitl: u32 = sealed_token_1.locked_until > sealed_token_2.locked_until 
            ? sealed_token_1.locked_until 
            : sealed_token_2.locked_until;

        let new_sealed_token: CompliantToken = CompliantToken {
            owner: base_token_1.owner,
            amount: sealed_token_1.amount + sealed_token_2.amount,
            locked_until: locked_unitl
        };

        let new_base_token: token_registry.aleo/Token = token_registry.aleo/join(
            base_token_1,
            base_token_2
        );

        return (new_sealed_token, new_base_token);
    }
}
