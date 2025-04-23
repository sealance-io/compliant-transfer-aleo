// The 'merkle_tree' program.
program rediwsozfo_v2.aleo {
    
    struct MerkleProof {
        siblings: [field; 16],
        leaf_index: u32
    }

    inline calculate_hash_for_neighbor(sibling1:field, sibling2:field, indexbit: u32) -> field {
        if indexbit == 0u32 {
            return Poseidon4::hash_to_field([sibling1, sibling2]);
        } else {
            return Poseidon4::hash_to_field([sibling2, sibling1]);
        }
    }

    // Todo: add inclusion proof

    // Function to calculate root from the siblings path
    inline calculate_root_siblings(leaf: field, merkle_proof: MerkleProof) -> field {
        let parent1: field = calculate_hash_for_neighbor(merkle_proof.siblings[0u8], merkle_proof.siblings[1u8], merkle_proof.leaf_index % 2u32);
        let parent2: field = calculate_hash_for_neighbor(parent1, merkle_proof.siblings[2u8], (merkle_proof.leaf_index / 2u32) % 2u32);
        let parent3: field =  merkle_proof.siblings[3u8] != 0field
            ?  calculate_hash_for_neighbor(parent2, merkle_proof.siblings[3u8], (merkle_proof.leaf_index / 4u32) % 2u32)
            :  parent2;
        let parent4: field = merkle_proof.siblings[4u8] != 0field
            ?  calculate_hash_for_neighbor(parent3, merkle_proof.siblings[4u8], (merkle_proof.leaf_index / 8u32) % 2u32)
            :  parent3;
        let parent5: field = merkle_proof.siblings[5u8] != 0field
            ?  calculate_hash_for_neighbor(parent4, merkle_proof.siblings[5u8], (merkle_proof.leaf_index / 16u32) % 2u32)
            :  parent4;
        let parent6: field =  merkle_proof.siblings[6u8] != 0field
            ?  calculate_hash_for_neighbor(parent5, merkle_proof.siblings[6u8], (merkle_proof.leaf_index / 32u32) % 2u32)
            :  parent5;
        let parent7: field = merkle_proof.siblings[7u8] != 0field
            ?  calculate_hash_for_neighbor(parent6, merkle_proof.siblings[7u8], (merkle_proof.leaf_index / 64u32) % 2u32)
            :  parent6;
        let parent8: field = merkle_proof.siblings[8u8] != 0field
            ?  calculate_hash_for_neighbor(parent7, merkle_proof.siblings[8u8], (merkle_proof.leaf_index / 128u32) % 2u32)
            :  parent7;
        let parent9: field =  merkle_proof.siblings[9u8] != 0field
            ?  calculate_hash_for_neighbor(parent8, merkle_proof.siblings[9u8], (merkle_proof.leaf_index / 256u32) % 2u32)
            :  parent8;
        let parent10: field =  merkle_proof.siblings[10u8] != 0field
            ?  calculate_hash_for_neighbor(parent9, merkle_proof.siblings[10u8], (merkle_proof.leaf_index / 512u32) % 2u32)
            :  parent9;
        let parent11: field = merkle_proof.siblings[11u8] != 0field
            ?  calculate_hash_for_neighbor(parent10, merkle_proof.siblings[11u8], (merkle_proof.leaf_index / 1024u32) % 2u32)
            :  parent10;
        let parent12: field = merkle_proof.siblings[12u8] != 0field
            ?  calculate_hash_for_neighbor(parent11, merkle_proof.siblings[12u8], (merkle_proof.leaf_index / 2048u32) % 2u32)
            :  parent11;
        let parent13: field =  merkle_proof.siblings[13u8] != 0field
            ?  calculate_hash_for_neighbor(parent12, merkle_proof.siblings[13u8], (merkle_proof.leaf_index / 4096u32) % 2u32)
            :  parent12;
        let parent14: field =  merkle_proof.siblings[14u8] != 0field
            ?  calculate_hash_for_neighbor(parent13, merkle_proof.siblings[14u8], (merkle_proof.leaf_index / 8192u32) % 2u32)
            :  parent13;
        let root: field =  merkle_proof.siblings[15u8] != 0field
            ?  calculate_hash_for_neighbor(parent14, merkle_proof.siblings[15u8], (merkle_proof.leaf_index / 16384u32) % 2u32)
            :  parent14;
        return root;
    }

    inline calculate_tree_depth(merkle_proof: MerkleProof) -> u32 {
        // first two siblings are the leaves and can be zero
        for i: u32 in 2u32..15u32 {
            if (merkle_proof.siblings[i] == 0field) {
                return i;
            }
        }
        return 15u32;
    }

    transition verify_non_inclusion(addr: address, merkle_proofs: [MerkleProof;2]) -> field {
        let root1: field = calculate_root_siblings(merkle_proofs[0u32].siblings[0u32], merkle_proofs[0u32]);
        let root2: field = calculate_root_siblings(merkle_proofs[1u32].siblings[0u32], merkle_proofs[1u32]);
        
        // Ensure the roots from merkle proofs are the same
        assert_eq(root1, root2);
        
        let addr_field: field = addr as field;
        if (merkle_proofs[0u32].leaf_index == merkle_proofs[1u32].leaf_index) {
            assert_eq(merkle_proofs[0u32].siblings, merkle_proofs[1u32].siblings);
            // Ensure that if the address is the most left leaf, it is less than the first sibling
            if (merkle_proofs[0u32].leaf_index == 0u32) {
                assert(addr_field < merkle_proofs[0u32].siblings[0u32]);
            } else if (merkle_proofs[0u32].leaf_index >= 7u32) {
                // Ensure that if the address is the most right leaf, it is greater than the last leaf
                let depth: u32 = calculate_tree_depth(merkle_proofs[0u32]);
                assert_eq(merkle_proofs[0u32].leaf_index, 2u32 ** (depth - 1u32) - 1u32);
                assert(addr_field > merkle_proofs[0u32].siblings[0u32]);
            }
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