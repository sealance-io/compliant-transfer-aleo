import merkle_tree8.aleo;

program block_list.aleo {
    
    // Constants
    const ADMIN_ROLE: address = aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px;

    // Mappings
    mapping merkle_root: u8 => field;
    mapping tree_mapping: u128 => address; 
    mapping tree_address: address => bool; 

    struct MerkleProof {
        siblings: [field; 4],
        leaf_index: u32
    }

    /* FLOWS

    ADMIN to update the list:
        1. (chain) get the current list (by reading the tree_mapping)
        2. add/remove a new address
        3. sort the leaves
        4. (chain) update tree -> update the mapping -> update root

    ADMIN to add/remove address:
        1. (chain) get the current list (by reading the tree_mapping)
        2. add/remove a new address
        3. sort the leaves
        4. (chain) build a new tree
        4. (chain) add_address/remove_address updating tree_address mapping and update the root 
WARNING: always make sure that tree_address and tree_mapping are in sync

    USER to generate a proof:
        1. (chain) get the current leaves
        2. find the closest leaf to the own address
        3. (chain) build tree
        4. (chain) compute siblings paths for left leaf
        5. (chain) compute siblings paths for right leaf
        5. (chain) verify non inclusion proof

    */

    // Transition to add new address to the list
    async transition add_address(addr: address, new_root: field) -> Future {
        return f_add_address(self.caller, addr, new_root);
    }
    async function f_add_address(caller:address, addr: address, new_root: field) {
        // Ensure the caller is the admin
        assert_eq(caller, ADMIN_ROLE);

        tree_address.set(addr, true);
        merkle_root.set(0u8, new_root);
    }

    // Transition to remove address from the list
    async transition remove_address(addr: address, new_root: field) -> Future {
        return f_remove_address(self.caller, addr, new_root);
    }
    async function f_remove_address(caller:address, addr: address, new_root: field) {
        // Ensure the caller is the admin
        assert_eq(caller, ADMIN_ROLE);

        tree_address.remove(addr);
        merkle_root.set(0u8, new_root);
    }

    // Transition to update the tree completely
    async transition update_list(list: [address; 8]) -> Future {
        // Ensure list is sorted
        assert(list[0u8] as field < list[1u8] as field);
        assert(list[1u8] as field < list[2u8] as field);
        assert(list[2u8] as field < list[3u8] as field);
        assert(list[3u8] as field < list[4u8] as field);
        assert(list[4u8] as field < list[5u8] as field);
        assert(list[5u8] as field < list[6u8] as field);  
        assert(list[6u8] as field < list[7u8] as field);  
        
        // Calculate root, since only admin can update the tree, we assume the root can be calculated offchain
        let tree:[field; 15] = merkle_tree8.aleo/build_tree(list);

        return f_update_list(self.caller, list, tree[14u8]);
    }
    async function f_update_list(caller:address, list: [address; 8], root: field) {
        // Ensure the caller is the admin
        assert_eq(caller, ADMIN_ROLE);

        // Update the tree mapping
        for i: u8 in 0u8..8u8 {
            tree_mapping.set(i as u128, list[i]);
        }

        // Update the tree address
       // for i: u8 in 0u8..8u8 {
       //     tree_address.set(list[i], true);
       // }
        // Build the tree and update the root
      //  let nodes: [field; 15] = merkle_tree8.aleo/build_subtree8(list);
        merkle_root.set(0u8, root);
    }

    // Transition to build the tree
    transition build_sorted_tree(list: [address; 8]) -> [field; 15] {
        return merkle_tree8.aleo/build_tree(list);
    }

    // Transition to get merkle proof (sinlings path and leaf index) for a leaf
    transition siblings_path(tree: [field; 15], leaf_index: u32) -> MerkleProof {
        return merkle_tree8.aleo/compute_sibling_path(tree, leaf_index);
    }

    // Transition to verify non-inclusion proof (modified to pass leaf_index)
    async transition verify_non_inclusion(addr: address, merkle_proofs: [MerkleProof;2]) -> Future {
        let root1: field = merkle_tree8.aleo/calculate_root_siblings(merkle_proofs[0u32].siblings[0u32], merkle_proofs[0u32]);
        let root2: field = merkle_tree8.aleo/calculate_root_siblings(merkle_proofs[1u32].siblings[0u32], merkle_proofs[1u32]);
        
        // Ensure the roots from merkle proofs are the same
        assert_eq(root1, root2);
        

        // Ensure the address is in between the provided leafs
        let addr_field: field = addr as field;
        assert(addr_field > merkle_proofs[0u32].siblings[0u32]);
        assert(addr_field < merkle_proofs[1u32].siblings[0u32]);

        // Ensure the leafs are adjacent
        assert_eq(merkle_proofs[0u32].leaf_index + 1u32, merkle_proofs[1u32].leaf_index);
        
        return f_verify_non_inclusion_proof(root1);
    } 
    async function f_verify_non_inclusion_proof(root: field) {
        let current_root: field = merkle_root.get(0u8);
        assert_eq(root, current_root);
    }

}
