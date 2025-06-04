program merkle_tree.aleo {
    const MAX_TREE_DEPTH: u32 = 15u32;
    
    struct MerkleProof {
        siblings: [field; 16],
        leaf_index: u32
    }

    inline calculate_hash_for_neighbor(sibling1:field, sibling2:field, indexbit: u32) -> field {
        let poseidon_params: [field;2] = indexbit == 0u32 ? [sibling1, sibling2] : [sibling2, sibling1];
        return Poseidon4::hash_to_field(poseidon_params);
    }

    transition verify_inclusion(addr: address, merkle_proof: MerkleProof) -> field {
      assert_eq(addr as field, merkle_proof.siblings[0u32]);
      let (root, depth): (field, u32)= calculate_root_depth_siblings(merkle_proof);
      return root;
    } 

    // Function to calculate root and depth from the siblings path
    inline calculate_root_depth_siblings(merkle_proof: MerkleProof) -> (public field, public u32) {
        let root: field = calculate_hash_for_neighbor(merkle_proof.siblings[0u8], merkle_proof.siblings[1u8],  merkle_proof.leaf_index % 2u32);
        for i: u32 in 2u32..MAX_TREE_DEPTH {
            if(merkle_proof.siblings[i] == 0field) {
                return (root, i);
            }
            root = calculate_hash_for_neighbor(root, merkle_proof.siblings[i], (merkle_proof.leaf_index / (2u32**(i-1u32))) % 2u32);
        }
        return (root, MAX_TREE_DEPTH);
    }

    transition verify_non_inclusion(addr: address, merkle_proofs: [MerkleProof;2]) -> field {
        let (root1, depth1): (field, u32)= calculate_root_depth_siblings(merkle_proofs[0u32]);
        let (root2, depth2): (field, u32) = calculate_root_depth_siblings(merkle_proofs[1u32]);

        // Ensure the roots from the merkle proofs are the same
        assert_eq(root1, root2);
        
        let addr_field: field = addr as field;
        if (merkle_proofs[0u32].leaf_index == merkle_proofs[1u32].leaf_index) {
            // Ensure that if the address is the most left leaf, it is less than the first sibling
            if (merkle_proofs[0u32].leaf_index == 0u32) {
                assert(addr_field < merkle_proofs[0u32].siblings[0u32]);
            } else {
                let last_index_leaf: u32 = 2u32 ** (depth1 - 1u32) - 1u32;
                assert_eq(merkle_proofs[0u32].leaf_index, last_index_leaf);
                assert(addr_field > merkle_proofs[0u32].siblings[0u32]);
            }
        } else {
            // Ensure the address is in between the provided leavess
            assert(addr_field > merkle_proofs[0u32].siblings[0u32]);
            assert(addr_field < merkle_proofs[1u32].siblings[0u32]);
            // Ensure the leavess are adjacent
            assert_eq(merkle_proofs[0u32].leaf_index + 1u32, merkle_proofs[1u32].leaf_index);
        }
        
        return root1;
    } 

}