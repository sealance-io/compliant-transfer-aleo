import merkle_tree.aleo;
import multisig_core.aleo;

program sealed_report_token.aleo {
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
    
    // Freeze list manager: can update the freeze list
    const FREEZE_LIST_MANAGER_INDEX: u8 = 4u8;
    const CURRENT_FREEZE_LIST_ROOT_INDEX: u8 = 1u8;
    const PREVIOUS_FREEZE_LIST_ROOT_INDEX: u8 = 2u8;
    const ROOT_UPDATED_HEIGHT_INDEX: bool = true;
    const BLOCK_HEIGHT_WINDOW_INDEX: bool = true;
    const FREEZE_LIST_LAST_INDEX: bool = true;

    const ZERO_ADDRESS: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc; // ZERO_ADDRESS as field equals to 0field
    const EMPTY_ROOT: field = 3642222252059314292809609689035560016959342421640560347114299934615987159853field; // hash of H(ZERO_ADDRESS, ZERO_ADDRESS)
    // Only this address can initialize the program
    const INITIAL_CONFIGURATION_ADDRESS: address = aleo1mh7al4qsedqvsh64pmmlcmzl5ugmrdxp4a4rdneja7etn8cpuspqvrj9q8;
    // This address receives compliance records (can be updated with the contract upgrade)
    const INVESTIGATOR_ADDRESS: address = aleo12ux3gdauck0v60westgcpqj7v8rrcr3v346e4jtq04q7kkt22czsh808v2;

    record Token {
        owner: address,
        amount: u128
    }

    // Compliance record used for the investigator
    record ComplianceRecord {
        owner: address,
        amount: u128,
        sender: address,
        recipient: address
    }

    struct MerkleProof {
        siblings: [field; 16],
        leaf_index: u32
    }

    struct TokenInfo {
        name: u128, // ASCII text represented in bits, and the u128 value of the bitstring
        symbol: u128, // ASCII text represented in bits, and the u128 value of the bitstring
        decimals: u8,
        supply: u128,
        max_supply: u128,
    }

    struct Allowance {
        account: address,
        spender: address,
    }

    struct ChecksumEdition {
        checksum: [u8; 32],
        edition: u16,
    }
    
    const TOKEN_INFO_INDEX: bool = true;
    // token specs
    mapping token_info: bool => TokenInfo;

    mapping balances: address => u128;
    mapping allowances: field => u128; // hash(account, spender) => Allowance

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
   // Roles can be assigned using bitmasking to allow multiple roles per address
    const NONE_ROLE: u16 = 0u16;
    const MINTER_ROLE: u16 = 1u16;
    const BURNER_ROLE: u16 = 2u16;
    const MANAGER_ROLE: u16 = 8u16; // can only assign roles
    const FREEZELIST_MANAGER_ROLE: u16 = 16u16; // can update the freeze list
    mapping address_to_role: address => u16;

    // -------------------------
    // Called by token admins
    // -------------------------

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
    // Can only be called by the freeze list manager.
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
        let role: u16 = address_to_role.get(caller);
        assert(role & FREEZELIST_MANAGER_ROLE == FREEZELIST_MANAGER_ROLE);

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
            // Verify that the frozen_index is empty.
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
            // Verify that we update the correct frozen_index
            assert_eq(current_address_at_index, account);
            freeze_list_index.set(frozen_index, ZERO_ADDRESS);
        }

        root_updated_height.set(ROOT_UPDATED_HEIGHT_INDEX, block.height);
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

    // Updates the number of blocks during which the previous root is still considered valid.
    // Can only be called by the admin.
    async transition update_block_height_window(public blocks: u32) -> Future {
        return f_update_block_height_window(blocks, self.caller);
    }
    async function f_update_block_height_window(blocks: u32, caller: address) {
        let role: u16 = address_to_role.get(caller);
        assert(role & FREEZELIST_MANAGER_ROLE == FREEZELIST_MANAGER_ROLE);

        block_height_window.set(BLOCK_HEIGHT_WINDOW_INDEX, blocks);
    }

    // Initializes the freeze list, token specifications, and the admin.
    // Can only be called once — ensures the contract has not already been initialized.    
    // Can be called only by the INITIAL_CONFIGURATION_ADDRESS
    // Sets the token info (name, symbol, decimals, max supply).
    // Sets the block height window, the initial empty Merkle root,
    // and initialize the freeze_list_last_index, freeze_list, and freeze_list_index with a ZERO_ADDRESS placeholder.
    async transition initialize(
        public name: u128,
        public symbol: u128,
        public decimals: u8,
        public max_supply: u128,
        public admin: address,
        public blocks: u32
    ) -> Future {
        return finalize_initialize(
            name,
            symbol,
            decimals,
            max_supply,
            admin,
            self.caller,
            blocks,
        );
    }
    async function finalize_initialize(
        name: u128,
        symbol: u128,
        decimals: u8,
        max_supply: u128,
        admin: address,
        caller: address,
        blocks: u32
    ) {
        // Check if the token has already been initialized
        let already_initialized: bool = token_info.contains(TOKEN_INFO_INDEX);
        assert_eq(already_initialized, false);

        assert_eq(caller, INITIAL_CONFIGURATION_ADDRESS);

        address_to_role.set(admin, MANAGER_ROLE);

        let token: TokenInfo = TokenInfo {
            name: name,
            symbol: symbol,
            decimals: decimals,
            supply: 0u128, // placeholder value; not used
            max_supply: max_supply
        };

        token_info.set(TOKEN_INFO_INDEX, token);

        block_height_window.set(BLOCK_HEIGHT_WINDOW_INDEX, blocks);
        freeze_list_last_index.set(FREEZE_LIST_LAST_INDEX, 0u32);
        freeze_list_root.set(CURRENT_FREEZE_LIST_ROOT_INDEX, EMPTY_ROOT);
        freeze_list.set(ZERO_ADDRESS, false);
        freeze_list_index.set(0u32, ZERO_ADDRESS);
    }

    // Mints new public tokens to the specified recipient’s balance.
    // Can be called by the admin, a minter, or a supply manager.
    // Ensures that the new total supply does not exceed the maximum supply.
    // Updates the recipient’s balance and the total token supply in the token info.
    async transition mint_public(
        public recipient: address,
        public amount: u128,
    ) -> Future {
        return finalize_mint_public(recipient, amount, self.caller);
    }
    async function finalize_mint_public(
        recipient: address,
        amount: u128,
        caller: address
    ) {
        let role: u16 = address_to_role.get(caller);
        assert(role & MINTER_ROLE == MINTER_ROLE);

        let token = token_info.get(TOKEN_INFO_INDEX);

        // Check that the token supply + amount <= max_supply
        let new_supply: u128 = token.supply + amount;
        assert(new_supply <= token.max_supply);

        // Update the balance
        let balance = balances.get_or_use(recipient, 0u128);
        let new_balance = amount + balance;
        balances.set(recipient, new_balance);
 

        // Update the token supply
        let new_info: TokenInfo = TokenInfo {
            name: token.name,
            symbol: token.symbol,
            decimals: token.decimals,
            supply: new_supply,
            max_supply: token.max_supply,
        };
        token_info.set(TOKEN_INFO_INDEX, new_info);
    }

    // Mints new private tokens to the specified recipient.
    // Can be called by the admin, a minter, or a supply manager.
    // Ensures that the new total supply does not exceed the maximum supply.
    // Updates the total token supply in the token info.
    async transition mint_private(
        recipient: address,
        public amount: u128
        ) -> (Token, Future) {
        let token: Token = Token {
            owner: recipient,
            amount: amount,
        };
        return (token, finalize_mint_private(amount, self.caller));
    }

    async function finalize_mint_private(
        amount: u128,
        caller: address,
    ) {
        let role: u16 = address_to_role.get(caller);
        assert(role & MINTER_ROLE == MINTER_ROLE);

        let token = token_info.get(TOKEN_INFO_INDEX);

        // Check that the token supply + amount <= max_supply
        let new_supply: u128 = token.supply + amount;
        assert(new_supply <= token.max_supply);

        // Update the token supply
        let new_info: TokenInfo = TokenInfo {
            name: token.name,
            symbol: token.symbol,
            decimals: token.decimals,
            supply: new_supply,
            max_supply: token.max_supply,
        };
        token_info.set(TOKEN_INFO_INDEX, new_info);
    }

    // Burns public tokens from the specified owner’s balance.
    // Can be called by the admin, a burner, or a supply manager.
    // Decreases the owner’s balance and reduces the total token supply in the token info.
    async transition burn_public(
        public owner: address,
        public amount: u128
    ) -> Future {
        return finalize_burn_public(owner, amount, self.caller);
    }

    async function finalize_burn_public(
        owner: address,
        amount: u128,
        caller: address,
    ) {
        let role: u16 = address_to_role.get(caller);
        assert(role & BURNER_ROLE == BURNER_ROLE);

        // Update the balance
        let balance = balances.get(owner);
        let new_balance = balance - amount;
        balances.set(owner, new_balance);

        let token = token_info.get(TOKEN_INFO_INDEX);

        let new_info: TokenInfo = TokenInfo {
            name: token.name,
            symbol: token.symbol,
            decimals: token.decimals,
            supply: token.supply - amount, // underflow will be caught by the VM
            max_supply: token.max_supply,
        };
        token_info.set(TOKEN_INFO_INDEX, new_info);
    }

    // Burns tokens from a private record (non-public asset).
    // Can be called by the admin, a burner, or a supply manager.
    // Reduces the amount in the provided private record and decreases the total token supply in the token info.
    async transition burn_private(
        input_record: Token,
        public amount: u128
    ) -> (Token, Future) {
        let output_record: Token = Token {
            owner: input_record.owner,
            amount: input_record.amount - amount
        };
        return (output_record, finalize_burn_private(amount, self.caller));
    }
    async function finalize_burn_private(
        amount: u128,
        caller: address,
    ) {
        let role: u16 = address_to_role.get(caller);
        assert(role & BURNER_ROLE == BURNER_ROLE);

        let token = token_info.get(TOKEN_INFO_INDEX);

        // Update the token supply
        let new_info: TokenInfo = TokenInfo {
            name: token.name,
            symbol: token.symbol,
            decimals: token.decimals,
            supply: token.supply - amount, // underflow will be caught by the VM
            max_supply: token.max_supply,
        };
        token_info.set(TOKEN_INFO_INDEX, new_info);
    }

    // -------------------------
    // Called by token owners/DeFi contracts
    // -------------------------

    // Transfers public tokens from the caller to the recipient.
    // Both sender and recipient must not be frozen in the freeze list.
    async transition transfer_public(
        public recipient: address,
        public amount: u128
    ) -> Future {
        return finalize_transfer_public(recipient, amount, self.caller);
    }
    async function finalize_transfer_public(
        recipient: address,
        amount: u128,
        sender: address
    ) {
        let is_sender_frozen: bool = freeze_list.get_or_use(sender, false);
        assert_eq(is_sender_frozen, false);
        let is_recipient_frozen: bool = freeze_list.get_or_use(recipient, false);
        assert_eq(is_recipient_frozen, false);

        let sender_balance = balances.get(sender);
        balances.set(sender, sender_balance - amount);

        let recipient_balance = balances.get_or_use(recipient, 0u128);
        balances.set(recipient, recipient_balance + amount);
    }

    // Transfers public tokens from the signer to the recipient.
    // Both sender and recipient must not be frozen in the freeze list.
    async transition transfer_public_as_signer(
        public recipient: address,
        public amount: u128
    ) -> Future {
        return f_transfer_public_as_signer(recipient, amount, self.signer);
    }
    async function f_transfer_public_as_signer(
        recipient: address,
        amount: u128,
        sender: address
    ) {
        let is_sender_frozen: bool = freeze_list.get_or_use(sender, false);
        assert_eq(is_sender_frozen, false);
        let is_recipient_frozen: bool = freeze_list.get_or_use(recipient, false);
        assert_eq(is_recipient_frozen, false);

        let sender_balance = balances.get(sender);
        balances.set(sender, sender_balance - amount);

        let recipient_balance = balances.get_or_use(recipient, 0u128);
        balances.set(recipient, recipient_balance + amount);
    }

    // Approves a spender to transfer the caller’s public assets up to a specified amount.
    // Increases the existing allowance if one is already set, otherwise creates a new allowance.
    // The allowance is stored using a hash of the owner–spender pair as the key.
    async transition approve_public(
        public spender: address,
        public amount: u128
    ) -> Future {
        let allowance: Allowance = Allowance {
            account: self.caller,
            spender: spender
        };
        let allowance_key: field = BHP256::hash_to_field(allowance);

        return finalize_approve_public(amount, allowance_key);
    }
    async function finalize_approve_public(
        amount: u128,
        allowance_key: field
    ) {
        let current_allowance: u128 = allowances.get_or_use(allowance_key, 0u128);
        // Increase or create the allowance amount
        allowances.set(allowance_key, current_allowance + amount);
    }

    // Reduces a spender’s allowance to transfer the caller’s public assets by a specified amount.
    // Decreases the existing allowance stored under the hash of the owner–spender pair.
    // If the reduction exceeds the current allowance, the VM will catch the underflow.
    async transition unapprove_public(
        public spender: address,
        public amount: u128
    ) -> Future {
        let allowance: Allowance = Allowance {
            account: self.caller,
            spender: spender
        };
        let allowance_key: field = BHP256::hash_to_field(allowance);

        return finalize_unapprove_public(amount, allowance_key);
    }
    async function finalize_unapprove_public(
        amount: u128,
        allowance_key: field
    ) {
        let current_allowance: u128 = allowances.get(allowance_key);
        // Decrease the allowance amount
        allowances.set(allowance_key, current_allowance - amount);
    }

    // Transfers public tokens from the owner to the recipient.
    // Can be called by any spender with sufficient allowance from the owner.
    // Decreases the spender’s allowance by the transferred amount.
    // Both sender and recipient must not be frozen in the freeze list.
    async transition transfer_from_public(
        public owner: address,
        public recipient: address,
        public amount: u128
    ) -> Future {
        let allowance: Allowance = Allowance {
            account: owner,
            spender: self.caller,
        };
        let allowance_key: field = BHP256::hash_to_field(allowance);

        return finalize_transfer_from_public(owner, recipient, amount, allowance_key);
    }
    async function finalize_transfer_from_public(
        sender: address,
        recipient: address,
        amount: u128,
        allowance_key: field
    ) {
        let is_sender_frozen: bool = freeze_list.get_or_use(sender, false);
        assert_eq(is_sender_frozen, false);
        let is_recipient_frozen: bool = freeze_list.get_or_use(recipient, false);
        assert_eq(is_recipient_frozen, false);

        // Check that the spender is authorized to spend the amount
        let current_allowance: u128 = allowances.get(allowance_key);
        // Decrease the allowance by the amount being spent
        allowances.set(allowance_key, current_allowance - amount);

        let sender_balance = balances.get(sender);
        balances.set(sender, sender_balance - amount);

        let recipient_balance = balances.get_or_use(recipient, 0u128);
        balances.set(recipient, recipient_balance + amount);
    }

    // Transfers public tokens from the caller to a recipient as a private token.
    // A ComplianceRecord is emitted for the investigator, who must match the stored investigator role.
    // Both sender and recipient must not be frozen in the freeze list.
    // The recipient's privacy is preserved by proving non-inclusion in the freeze list Merkle tree.
    async transition transfer_public_to_private(
        recipient: address,
        public amount: u128,
        recipient_merkle_proofs: [MerkleProof;2]
    ) -> (ComplianceRecord, Token, Future) {
        let root: field = merkle_tree.aleo/verify_non_inclusion(recipient, recipient_merkle_proofs);

        let token: Token = Token {
            owner: recipient,
            amount: amount
        };

        let compliance_record: ComplianceRecord = ComplianceRecord {
            owner: INVESTIGATOR_ADDRESS,
            amount: amount,
            sender: self.caller,
            recipient: recipient,
        };

        return (compliance_record, token, f_transfer_public_to_private(amount, self.caller, root));
    }
    async function f_transfer_public_to_private(
        amount: u128,
        sender: address,
        root: field
    ) {
        let current_root: field = freeze_list_root.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
        if (current_root != root) {
            let previous_root: field = freeze_list_root.get(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
            assert_eq(root, previous_root);
            let window: u32 = block_height_window.get(BLOCK_HEIGHT_WINDOW_INDEX);
            let updated_height: u32 = root_updated_height.get(ROOT_UPDATED_HEIGHT_INDEX);
            assert(updated_height + window > block.height);
        } 

        let is_sender_frozen: bool = freeze_list.get_or_use(sender, false);
        assert_eq(is_sender_frozen, false);

        let sender_balance = balances.get(sender);
        balances.set(sender, sender_balance - amount);
    }

    // Transfers public tokens from an owner to a recipient as a private token.
    // Can be called by any spender with sufficient allowance from the owner.
    // Decreases the spender’s allowance by the transferred amount.
    // A ComplianceRecord is emitted for the investigator, who must match the stored investigator role.
    // Both sender and recipient must not be frozen in the freeze list.
    // The recipient's privacy is preserved by proving non-inclusion in the freeze list Merkle tree.
    async transition transfer_from_public_to_private(
        public owner: address,
        recipient: address,
        public amount: u128,
        recipient_merkle_proofs: [MerkleProof;2]
    ) -> (ComplianceRecord, Token, Future) {
        let root: field = merkle_tree.aleo/verify_non_inclusion(recipient, recipient_merkle_proofs);
        
        let token: Token = Token {
            owner: recipient,
            amount: amount
        };

        let allowance: Allowance = Allowance {
            account: owner,
            spender: self.caller,
        };
        let allowance_key: field = BHP256::hash_to_field(allowance);

        let compliance_record: ComplianceRecord = ComplianceRecord {
            owner: INVESTIGATOR_ADDRESS,
            amount: amount,
            sender: owner,
            recipient: recipient,
        };

        return (compliance_record, token, f_transfer_from_public_to_priv(owner, amount, allowance_key, root));
    }
    async function f_transfer_from_public_to_priv(
        sender: address,
        amount: u128,
        allowance_key: field,
        root: field
    ) {
        let current_root: field = freeze_list_root.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
        if (current_root != root) {
            let previous_root: field = freeze_list_root.get(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
            assert_eq(root, previous_root);
            let window: u32 = block_height_window.get(BLOCK_HEIGHT_WINDOW_INDEX);
            let updated_height: u32 = root_updated_height.get(ROOT_UPDATED_HEIGHT_INDEX);
            assert(updated_height + window > block.height);
        } 

        let is_sender_frozen: bool = freeze_list.get_or_use(sender, false);
        assert_eq(is_sender_frozen, false);

        // Check that the spender is authorized to spend the amount
        let current_allowance: u128 = allowances.get(allowance_key);
        // Decrease the allowance by the amount being spent
        allowances.set(allowance_key, current_allowance - amount);

        let sender_balance = balances.get(sender);
        balances.set(sender, sender_balance - amount);
    }

    // Transfers private tokens from the record owner to a recipient.
    // A ComplianceRecord is emitted for the investigator, who must match the stored investigator role.
    // Both sender and recipient must not be frozen in the freeze list.
    // The sender's and recipient's privacy is preserved by proving non-inclusion in the freeze list Merkle tree.
    async transition transfer_private(
        recipient: address,
        amount: u128,
        input_record: Token,
        sender_merkle_proofs: [MerkleProof;2],
        recipient_merkle_proofs: [MerkleProof;2]
    ) -> (ComplianceRecord, Token, Token, Future) {
        let sender_root: field = merkle_tree.aleo/verify_non_inclusion(input_record.owner, sender_merkle_proofs);
        let recipient_root: field = merkle_tree.aleo/verify_non_inclusion(recipient, recipient_merkle_proofs);
        assert_eq(sender_root, recipient_root);

        let updated_record: Token = Token {
            owner: input_record.owner,
            amount: input_record.amount - amount
        };

        let transfer_record: Token = Token {
            owner: recipient,
            amount: amount
        };

        let compliance_record: ComplianceRecord = ComplianceRecord {
            owner: INVESTIGATOR_ADDRESS,
            amount: amount,
            sender: input_record.owner,
            recipient: recipient,
        };

        return (compliance_record, updated_record, transfer_record, f_transfer_private(sender_root));
    }

    async function f_transfer_private(root: field) {
        let current_root: field = freeze_list_root.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
        if (current_root != root) {
            let previous_root: field = freeze_list_root.get(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
            assert_eq(root, previous_root);
            let window: u32 = block_height_window.get(BLOCK_HEIGHT_WINDOW_INDEX);
            let updated_height: u32 = root_updated_height.get(ROOT_UPDATED_HEIGHT_INDEX);
            assert(updated_height + window > block.height);
        }
    }

    // Transfers private tokens from the record owner to a recipient as a public tokens.
    // A ComplianceRecord is emitted for the investigator, who must match the stored investigator role.
    // Both sender and recipient must not be frozen in the freeze list.
    // The sender's privacy is preserved by proving non-inclusion in the freeze list Merkle tree.
    async transition transfer_private_to_public(
        public recipient: address,
        public amount: u128,
        input_record: Token,
        sender_merkle_proofs: [MerkleProof; 2]
    ) -> (ComplianceRecord, Token, Future) {
        let root: field = merkle_tree.aleo/verify_non_inclusion(input_record.owner, sender_merkle_proofs);

        let updated_record: Token = Token {
            owner: input_record.owner,
            amount: input_record.amount - amount
        };

        let compliance_record: ComplianceRecord = ComplianceRecord {
            owner: INVESTIGATOR_ADDRESS,
            amount: amount,
            sender: input_record.owner,
            recipient: recipient,
        };

        return (
            compliance_record,
            updated_record,
            f_transfer_private_to_public(
                root,
                recipient,
                amount
            )
        );
    }
    async function f_transfer_private_to_public(
        root: field,
        recipient: address,
        amount: u128
    ) {
        let current_root: field = freeze_list_root.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
        if (current_root != root) {
            let previous_root: field = freeze_list_root.get(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
            assert_eq(root, previous_root);
            let window: u32 = block_height_window.get(BLOCK_HEIGHT_WINDOW_INDEX);
            let updated_height: u32 = root_updated_height.get(ROOT_UPDATED_HEIGHT_INDEX);
            assert(updated_height + window > block.height);
        }    

        let is_recipient_frozen: bool = freeze_list.get_or_use(recipient, false);
        assert_eq(is_recipient_frozen, false);

        let recipient_balance = balances.get_or_use(recipient, 0u128);
        balances.set(recipient, recipient_balance + amount);
    }

    transition join(
        private token_1: Token,
        private token_2: Token
    ) -> Token {
        let new_token: Token = Token {
            owner: token_1.owner,
            amount: token_1.amount + token_2.amount
        };

        return new_token;
    }

    transition split(
        private token: Token,
        private amount: u128
    ) -> (Token, Token) {
        let new_token_1: Token = Token {
            owner: token.owner,
            amount: amount
        };
        let new_token_2: Token = Token {
            owner: token.owner,
            amount: token.amount - amount
        };

        return (new_token_1, new_token_2);
    }
}