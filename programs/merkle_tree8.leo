program merkle_tree8.aleo {
    // Constants
    const TREE_DEPTH: u128 = 4u128;
    const LEAVES_SIZE: u128 = 8u128;
    const TREE_SIZE: u128 = 15u128;

    struct MerkleProof {
        siblings: [field; 4],
        leaf_index: u32
    }

    // Problems:
    // 1. Cannot have dynamic arrays, so need to manually calculate all nodes
    // 2. need to manually calculate all siblings

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

    // Create a sibling path for a leaf
    function compute_sibling_path(tree: [field; 15], leaf_index: u32) -> MerkleProof {
        if leaf_index == 0u32 {
            return MerkleProof{siblings:[tree[0u32], tree[1u8], tree[9u8], tree[13u8]],leaf_index:leaf_index};
       } else if leaf_index == 1u32 {
            return MerkleProof{siblings:[tree[1u32], tree[0u8], tree[9u8], tree[13u8]],leaf_index:leaf_index};
        } else if leaf_index == 2u32 {
            return MerkleProof{siblings:[tree[2u32], tree[3u8], tree[8u8], tree[13u8]],leaf_index:leaf_index};
        } else if leaf_index == 3u32 {
            return MerkleProof{siblings:[tree[3u32], tree[2u8], tree[8u8], tree[13u8]],leaf_index:leaf_index};
        } else if leaf_index == 4u32 {
            return MerkleProof{siblings:[tree[4u32], tree[5u8], tree[11u8], tree[12u8]],leaf_index:leaf_index};
        } else if leaf_index == 5u32 {
            return MerkleProof{siblings:[tree[5u32], tree[4u8], tree[11u8], tree[12u8]],leaf_index:leaf_index};
        } else if leaf_index == 6u32 {
            return MerkleProof{siblings:[tree[6u32], tree[7u8], tree[10u8], tree[12u8]],leaf_index:leaf_index};
        } else if leaf_index == 7u32 {
            return MerkleProof{siblings:[tree[7u32], tree[6u8], tree[10u8], tree[12u8]],leaf_index:leaf_index};
        }

        return MerkleProof{siblings:[0field, 0field, 0field, 0field],leaf_index:0u32};
    }

    inline calculate_hash_for_neighbor(sibling1:field, sibling2:field, indexbit: u32) -> field {
        if indexbit == 0u32 {
            return Poseidon4::hash_to_field([sibling1, sibling2]);
        } else {
            return Poseidon4::hash_to_field([sibling2, sibling1]);
        }
    }

    // Function to calculate root from the siblings path
    function calculate_root_siblings(leaf: field, merkle_proof: MerkleProof) -> field {
        let parent1: field = calculate_hash_for_neighbor(merkle_proof.siblings[0u8], merkle_proof.siblings[1u8], merkle_proof.leaf_index % 2u32);
        let parent2:field = calculate_hash_for_neighbor(parent1, merkle_proof.siblings[2u8], (merkle_proof.leaf_index / 2u32) % 2u32);
        let root:field = calculate_hash_for_neighbor(parent2, merkle_proof.siblings[3u8], (merkle_proof.leaf_index / 4u32) % 2u32);
        return root;
    }

}
