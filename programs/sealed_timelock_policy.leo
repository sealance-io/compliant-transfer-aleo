import token_registry.aleo;
import sealance_freezelist_registry.aleo;

program sealed_timelock_policy.aleo {
    @custom
    async constructor() {
        let admin_address: address = roles.get_or_use(ADMIN_INDEX, self.program_owner);
        assert_eq(admin_address, self.program_owner);
    }
    
    // token specs
    const TOKEN_ID: field = 31155203188273609789785737924444174490841009372087129field; // TIMELOCK ascii encoded
    const NAME: u128 = 1709529976692281403789758276781390u128; // name: u128, TIMELOCK_TOKEN ascii encoded
    const SYMBOL: u128 = 6073470532514169675u128; // symbol: u128, TIMELOCK ascii encoded
    const DECIMALS: u8 = 6u8;
    const TOTAL_SUPPLY: u128 = 1_000_000_000_000_000u128;

    const ZERO_ADDRESS: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc; // ZERO_ADDRESS as field equals to 0field
    const PROGRAM_ADDRESS: address = aleo1q40dlwxfgka53c3wt5ef5k0yvf06dksgcrkdc0r20xpky0ezwqrqpzggeq;
    const AUTHORIZED_UNTIL: u32 = 4294967295u32; // Set to the maximum u32 to avoid expiration. However, the asset is always used immediately in the same transaction
    const FREEZE_REGISTRY_PROGRAM_NAME: u128 = 531934507715736310883939492834865785u128;// freeze_registry ascii encoded

    // Admin: can assign roles, mint tokens and upgrade the program 
    const ADMIN_INDEX: u8 = 1u8;
    // Minter: allowed to mint tokens
    const MINTER_INDEX: u8 = 3u8;
    const FREEZE_REGISTRY_PROGRAM_INDEX: bool = true;

    // Mappings
    // Stores the ASCII-encoded name of the freeze registry program.
    // Used by off-chain parties to locate the correct program for generating Merkle proofs.
    mapping freeze_registry_program_name: bool => u128;
    // Maps a role ID to an address (e.g., 1 = admin, 3 = minter).
    mapping roles: u8 => address;

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

    // Sets the admin to the caller
    // Sets the freeze_registry_program_name mapping
    // Registers the token and assigns this program as both the token admin and the external authorization party
    async transition initialize() -> Future {
        // Set admin and external_authorization_party to be PROGRAM_ADDRESS
        let token_registry_call: Future = token_registry.aleo/register_token(
            TOKEN_ID,
            NAME,
            SYMBOL,
            DECIMALS,
            TOTAL_SUPPLY,
            true,
            PROGRAM_ADDRESS // external_authorization_party
        );
        return f_initialize(token_registry_call, self.caller );
    }
    async function f_initialize(token_registry_call: Future, caller: address) {
        freeze_registry_program_name.set(FREEZE_REGISTRY_PROGRAM_INDEX, FREEZE_REGISTRY_PROGRAM_NAME);
        roles.set(ADMIN_INDEX, caller);

        token_registry_call.await();
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

    // Mints public tokens to the specified recipient and creates a corresponding CompliantToken record.
    // The caller must be the admin or an authorized minter.
    // The CompliantToken will be locked until the specified block height.
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

        let recipient_compliant_record: CompliantToken = CompliantToken {
            owner: recipient,
            amount: amount,
            locked_until: lock_until
        };

        return (recipient_compliant_record, finalize_mint_public(token_registry_call, self.caller));
    }
    async function finalize_mint_public(
        token_registry_call: Future,
        caller: address
    ) {
        let admin_address: address = roles.get(ADMIN_INDEX);
        let minter_address: address = roles.get_or_use(MINTER_INDEX, ZERO_ADDRESS);
        assert(admin_address == caller || minter_address == caller);

        token_registry_call.await();
    }

    // Mints private tokens to the specified recipient and creates a corresponding CompliantToken record.
    // The caller must be the admin or an authorized minter.
    // The CompliantToken will be locked until the specified block height.
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

        let recipient_compliant_record: CompliantToken = CompliantToken {
            owner: recipient,
            amount: amount,
            locked_until: lock_until
        };

        return (recipient_compliant_record, token_registry_call.0, finalize_mint_private(token_registry_call.1, self.caller));
    }
    async function finalize_mint_private(
        token_registry_call: Future,
        caller: address
    ) {
        let admin_address: address = roles.get(ADMIN_INDEX);
        let minter_address: address = roles.get_or_use(MINTER_INDEX, ZERO_ADDRESS);
        assert(admin_address == caller || minter_address == caller);

        token_registry_call.await();
    }

    // -------------------------
    // Called by token owners/DeFi contracts
    // -------------------------

    // Transfers public tokens from the caller to the recipient.
    // The caller must first approve this contract in the token_registry via the approve transition.
    // The user must provide an unlocked CompliantToken with an amount greater than the transferred amount.
    // The user specifies the block height at which the recipient can begin using the received asset.
    // Both sender and recipient must not be frozen in the freeze list.
    async transition transfer_public(
        public recipient: address,
        public amount: u128,
        sealed_token: CompliantToken,
        lock_until: u32,
    ) -> (CompliantToken, CompliantToken, Future) {
        assert_eq(self.caller, sealed_token.owner);

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

        let sender_compliant_record: CompliantToken = CompliantToken {
            owner: sealed_token.owner,
            amount: sealed_token.amount - amount,
            locked_until: sealed_token.locked_until
        };

        let recipient_compliant_record: CompliantToken = CompliantToken {
            owner: recipient,
            amount: amount,
            locked_until: lock_until
        };

        return (
            sender_compliant_record,
            recipient_compliant_record, 
            finalize_transfer_public(sealed_token.locked_until, verify_sender, verify_recipient, authorization_call, transfer_call)
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

    // Transfers public tokens from the signer to the recipient.
    // The user must provide an unlocked CompliantToken with an amount greater than the transferred amount.
    // The user specifies the block height at which the recipient can begin using the received asset.
    // Both sender and recipient must not be frozen in the freeze list.
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

        let sender_compliant_record: CompliantToken = CompliantToken {
            owner: sealed_token.owner,
            amount: sealed_token.amount - amount,
            locked_until: sealed_token.locked_until
        };

        let recipient_compliant_record: CompliantToken = CompliantToken {
            owner: recipient,
            amount: amount,
            locked_until: lock_until
        };

        return (
            sender_compliant_record,
            recipient_compliant_record, 
            f_transfer_public_as_signer(sealed_token.locked_until, verify_sender, verify_recipient, authorization_call, transfer_call)
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

    // Transfers public tokens from the caller to a recipient as a private token.
    // The caller must first approve this contract in the token_registry via the approve transition.
    // The user must provide an unlocked CompliantToken with an amount greater than the transferred amount.
    // The user specifies the block height at which the recipient can begin using the received asset.
    // Both sender and recipient must not be frozen in the freeze list.
    // The recipient's privacy is preserved by proving non-inclusion in the freeze list Merkle tree.
    async transition transfer_public_to_priv(
        recipient: address,
        public amount: u128,
        sealed_token: CompliantToken,
        recipient_merkle_proofs: [MerkleProof;2],
        lock_until: u32
    ) -> (CompliantToken, CompliantToken, token_registry.aleo/Token, Future) {
        assert_eq(self.caller, sealed_token.owner);

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

        let program_owner: TokenOwner = TokenOwner {
            account: PROGRAM_ADDRESS,
            token_id: TOKEN_ID
        };

        let sender_compliant_record: CompliantToken = CompliantToken {
            owner: sealed_token.owner,
            amount: sealed_token.amount - amount,
            locked_until: sealed_token.locked_until
        };

        let recipient_compliant_record: CompliantToken = CompliantToken {
            owner: recipient,
            amount: amount,
            locked_until: lock_until
        };

        return (
            sender_compliant_record,
            recipient_compliant_record,
            transfer_call.0, 
            f_transfer_public_to_priv(
                sealed_token.locked_until,
                verify_sender,
                verify_recipient,
                authorization_call,
                transfer_call.1, 
            )
        );
    }
    async function f_transfer_public_to_priv(
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

    // Transfers private tokens from the record owner to a recipient.
    // The user must provide an unlocked CompliantToken with an amount greater than the transferred amount.
    // The user specifies the block height at which the recipient can begin using the received asset.
    // Both sender and recipient must not be frozen in the freeze list.
    // The sender's and recipient's privacy is preserved by proving non-inclusion in the freeze list Merkle tree.
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

        let sender_compliant_record: CompliantToken = CompliantToken {
            owner: sealed_token.owner,
            amount: sealed_token.amount - amount,
            locked_until: sealed_token.locked_until
        };

        let recipient_compliant_record: CompliantToken = CompliantToken {
            owner: recipient,
            amount: amount,
            locked_until: lock_until
        };

        return (
            sender_compliant_record,
            recipient_compliant_record,
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
        transfer_call: Future    
    ) {
        verify_sender.await();
        verify_recipient.await();
        authorization_call.await();
        transfer_call.await();

        assert(locked_until <= block.height);
    }

    // Transfers private tokens from the record owner to a recipient as a public tokens.
    // The user must provide an unlocked CompliantToken with an amount greater than the transferred amount.
    // The user specifies the block height at which the recipient can begin using the received asset.
    // Both sender and recipient must not be frozen in the freeze list.
    // The sender's privacy is preserved by proving non-inclusion in the freeze list Merkle tree.
    async transition transfer_priv_to_public(
        public recipient: address,
        public amount: u128,
        sealed_token: CompliantToken,
        base_token: token_registry.aleo/Token,
        sender_merkle_proofs: [MerkleProof; 2],
        lock_until: u32,
    ) -> (CompliantToken, CompliantToken, token_registry.aleo/Token, Future) {
        assert_eq(base_token.token_id, TOKEN_ID);

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
        
        let sender_compliant_record: CompliantToken = CompliantToken {
            owner: sealed_token.owner,
            amount: sealed_token.amount - amount,
            locked_until: sealed_token.locked_until
        };

        let recipient_compliant_record: CompliantToken = CompliantToken {
            owner: recipient,
            amount: amount,
            locked_until: lock_until
        };

        return (
            sender_compliant_record,
            recipient_compliant_record,
            authorization_call.0,
            f_transfer_priv_to_public(
                sealed_token.locked_until,
                verify_sender,
                verify_recipient,
                authorization_call.2, 
                transfer_call.1, 
            )
        );
    }
    async function f_transfer_priv_to_public(
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

    // Joins two CompliantToken records into a single record.
    // The resulting record is locked until the later of the two original lock times.
    transition join(
        sealed_token_1: CompliantToken,
        sealed_token_2: CompliantToken,
    ) -> CompliantToken {

        let locked_until: u32 = sealed_token_1.locked_until > sealed_token_2.locked_until 
            ? sealed_token_1.locked_until 
            : sealed_token_2.locked_until;

        let new_sealed_token: CompliantToken = CompliantToken {
            owner: sealed_token_1.owner,
            amount: sealed_token_1.amount + sealed_token_2.amount,
            locked_until: locked_until
        };

        return new_sealed_token;
    }
}
