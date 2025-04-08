import token_registry.aleo;
import freeze_registry.aleo;

program compliant_timelock_transfer.aleo {

    const TOKEN_ID: field = 1688926949047677303695061932791346field; // SEALEDTOKEN_V2 ascii encoded
    const PROGRAM_ADDRESS: address = aleo1f03a508uvg5fskrmzqfqyvvzd58989m2fhd02ef99qnkt85whs8q3kfjev;
    const AUTHORIZED_UNTIL: u32 = 4294967295u32;
    const FREEZE_REGISTRY_PROGRAM_NAME: u128 = 1u128;// freeze_registry ascii encoded

    // Mappings
    mapping freeze_registry_program_name: u8 => u128;

    const ADMIN_ROLE: u8 = 1u8;
    mapping roles: u8 => address;

    struct MerkleProof {
        siblings: [field; 16],
        leaf_index: u32
    }

    record CompliantToken {
        owner: address,
        amount: u128,
        token_id: field,
        locked_until: u32
    } 

    struct TokenOwner {
        account: address,
        token_id: field
    }

    async transition init_freeze_registry_name() -> Future {
        return f_init_freeze_registry_name();
    }
    async function f_init_freeze_registry_name() {
        freeze_registry_program_name.set(0u8, FREEZE_REGISTRY_PROGRAM_NAME);
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
        public amount: u128,
        sealed_token: CompliantToken,
        public lock_until: u32,
    ) -> (CompliantToken, CompliantToken, Future) {

        assert_eq(sealed_token.token_id, TOKEN_ID);
       // assert(sealed_token.locked_until <= current_height);

        let verify_sender: Future = freeze_registry.aleo/verify_non_inclusion_pub(self.caller);
        let verify_recipient: Future = freeze_registry.aleo/verify_non_inclusion_pub(recipient);

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
            token_id: sealed_token.token_id,
            locked_until: sealed_token.locked_until
        };

        let authorized_record: CompliantToken = CompliantToken {
            owner: recipient,
            amount: amount,
            token_id: sealed_token.token_id,
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
        public lock_until: u32
    ) -> (CompliantToken, CompliantToken, Future) {
        let verify_sender: Future = freeze_registry.aleo/verify_non_inclusion_pub(self.signer);
        let verify_recipient: Future = freeze_registry.aleo/verify_non_inclusion_pub(recipient);

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
            token_id: sealed_token.token_id,
            locked_until: sealed_token.locked_until
        };

        let authorized_record: CompliantToken = CompliantToken {
            owner: recipient,
            amount: amount,
            token_id: sealed_token.token_id,
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
        let verify_sender: Future = freeze_registry.aleo/verify_non_inclusion_pub(self.caller);
        let verify_recipient: Future = freeze_registry.aleo/verify_non_inclusion_priv(recipient, recipient_merkle_proofs);
        
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
            token_id: sealed_token.token_id,
            locked_until: sealed_token.locked_until
        };

        let authorized_record: CompliantToken = CompliantToken {
            owner: recipient,
            amount: amount,
            token_id: sealed_token.token_id,
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
       // current_height: u32, // if we provide it, we can prevent the onchain rejection
    ) -> (CompliantToken, CompliantToken, token_registry.aleo/Token, token_registry.aleo/Token, Future) {
        assert_eq(base_token.token_id, TOKEN_ID);
        assert_eq(sealed_token.token_id, TOKEN_ID);
        assert_eq(base_token.amount, sealed_token.amount);
       // assert(sealed_token.locked_until <= current_height);

        let verify_sender: Future = freeze_registry.aleo/verify_non_inclusion_priv(base_token.owner, sender_merkle_proofs);
        let verify_recipient: Future = freeze_registry.aleo/verify_non_inclusion_priv(recipient, recipient_merkle_proofs);

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
            token_id: sealed_token.token_id,
            locked_until: sealed_token.locked_until
        };

        let authorized_record: CompliantToken = CompliantToken {
            owner: recipient,
            amount: amount,
            token_id: sealed_token.token_id,
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
        public lock_until: u32,

    ) -> (CompliantToken, CompliantToken, token_registry.aleo/Token, Future) {
        assert_eq(base_token.token_id, TOKEN_ID);
        assert_eq(sealed_token.token_id, TOKEN_ID);
        assert_eq(base_token.amount, sealed_token.amount);
       // assert(sealed_token.locked_until <= current_height);

        let verify_sender: Future = freeze_registry.aleo/verify_non_inclusion_priv(base_token.owner, sender_merkle_proofs);
        let verify_recipient: Future = freeze_registry.aleo/verify_non_inclusion_pub(recipient);

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
            token_id: sealed_token.token_id,
            locked_until: sealed_token.locked_until
        };

        let authorized_record: CompliantToken = CompliantToken {
            owner: recipient,
            amount: amount,
            token_id: sealed_token.token_id,
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

}