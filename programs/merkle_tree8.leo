program merkle_tree8.aleo {
    
    // Constants
    const TREE_DEPTH: u128 = 4u128;
    const LEAVES_SIZE: u128 = 8u128;
    const TREE_SIZE: u128 = 15u128;

    struct MerkleProof {
        siblings: [field; 4],
        leaf_index: u32
    }

    // Build the subtree
    transition build_tree(leaves: [address; 8]) -> [field; 15] {

        // First Layer
        let parent1:field = Poseidon4::hash_to_field([leaves[0u8] as field, leaves[1u8] as field]);
        let parent2:field = Poseidon4::hash_to_field([leaves[2u8] as field, leaves[3u8] as field]);
        let parent3:field = Poseidon4::hash_to_field([leaves[4u8] as field, leaves[5u8] as field]);
        let parent4:field = Poseidon4::hash_to_field([leaves[6u8] as field, leaves[7u8] as field]);

        // Second layer
        let parent5:field = Poseidon4::hash_to_field([parent1, parent2]);
        let parent6:field = Poseidon4::hash_to_field([parent3, parent4]);

        // Root
        let root:field = Poseidon4::hash_to_field([parent5, parent6]);
        
        return [
            leaves[0u8] as field,
            leaves[1u8] as field,
            leaves[2u8] as field,
            leaves[3u8] as field,
            leaves[4u8] as field,
            leaves[5u8] as field,
            leaves[6u8] as field,
            leaves[7u8] as field,
            parent1, parent2, parent3, parent4, 
            parent5, parent6, 
            root
        ];
    }

    inline calculate_hash_for_neighbor(sibling1:field, sibling2:field, indexbit: u32) -> field {
        if indexbit == 0u32 {
            return Poseidon4::hash_to_field([sibling1, sibling2]);
        } else {
            return Poseidon4::hash_to_field([sibling2, sibling1]);
        }
    }

    // Function to calculate root from the siblings path
    // TODO: extend to 16 elements
    inline calculate_root_siblings(leaf: field, merkle_proof: MerkleProof) -> field {
        let parent1: field = calculate_hash_for_neighbor(merkle_proof.siblings[0u8], merkle_proof.siblings[1u8], merkle_proof.leaf_index % 2u32);
        let parent2:field = calculate_hash_for_neighbor(parent1, merkle_proof.siblings[2u8], (merkle_proof.leaf_index / 2u32) % 2u32);
        let root:field =  merkle_proof.siblings[3u8] != 0field
            ?  calculate_hash_for_neighbor(parent2, merkle_proof.siblings[3u8], (merkle_proof.leaf_index / 4u32) % 2u32)
            :  parent2;

        return root;
    }

    transition verify_non_inclusion(addr: address, merkle_proofs: [MerkleProof;2]) -> field {
        let root1: field = merkle_tree8.aleo/calculate_root_siblings(merkle_proofs[0u32].siblings[0u32], merkle_proofs[0u32]);
        let root2: field = merkle_tree8.aleo/calculate_root_siblings(merkle_proofs[1u32].siblings[0u32], merkle_proofs[1u32]);
        
        // Ensure the roots from merkle proofs are the same
        assert_eq(root1, root2);
        
        let addr_field: field = addr as field;
        if (merkle_proofs[0u32].leaf_index == merkle_proofs[1u32].leaf_index) && (merkle_proofs[0u32].leaf_index == 0u32) {
            // Ensure that if the address is the most left leaf, it is less than the first sibling
            assert_eq(merkle_proofs[0u32].siblings, merkle_proofs[1u32].siblings);
            assert(addr_field < merkle_proofs[0u32].siblings[0u32]);
        } else if (merkle_proofs[0u32].leaf_index == merkle_proofs[1u32].leaf_index) && (merkle_proofs[0u32].leaf_index == 7u32) {
            // Ensure that if the address is the most right leaf, it is more than the last l
            assert_eq(merkle_proofs[0u32].siblings, merkle_proofs[1u32].siblings);
            assert(addr_field > merkle_proofs[0u32].siblings[0u32]);
        } else {
            // Ensure the address is in between the provided leafs
            assert(addr_field > merkle_proofs[0u32].siblings[0u32]);
            assert(addr_field < merkle_proofs[1u32].siblings[0u32]);
            // Ensure the leafs are adjacent
            assert_eq(merkle_proofs[0u32].leaf_index + 1u32, merkle_proofs[1u32].leaf_index);
        }
        
        return root1;
    } 

}