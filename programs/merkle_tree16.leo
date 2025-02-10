import merkle_tree8.aleo;

program merkle_tree16.aleo {
    // Constants
    const TREE_DEPTH: u128 = 5u128;
    const LEAVES_SIZE: u128 = 16u128;
    const TREE_SIZE: u128 = 31u128;

    // Build the subtree
    transition build_tree(leaves: [address; 16]) -> [field; 31] {

        let tree_left: [field; 15] = merkle_tree8.aleo/build_tree([leaves[0u32],leaves[1u32],leaves[2u32],leaves[3u32],leaves[4u32],leaves[5u32],leaves[6u32],leaves[7u32]]);
        let tree_right: [field; 15] = merkle_tree8.aleo/build_tree([leaves[8u32],leaves[9u32],leaves[10u32],leaves[11u32],leaves[12u32],leaves[13u32],leaves[14u32],leaves[15u32]]);
        let root:field = Poseidon4::hash_to_field([tree_left[14u32], tree_right[14u32]]);
        
        return [
            tree_left[0u8],tree_left[1u8],tree_left[2u8],tree_left[3u8], tree_left[4u8],tree_left[5u8],tree_left[6u8],tree_left[7u8],tree_right[0u8],tree_right[1u8],tree_right[2u8],tree_right[3u8],tree_right[4u8],tree_right[5u8],tree_right[6u8],tree_right[7u8],
            tree_left[8u8],tree_left[9u8],tree_left[10u8],tree_left[11u8],tree_right[8u8],tree_right[9u8],tree_right[10u8],tree_right[11u8],
            tree_left[12u8],tree_left[13u8],tree_right[12u8],tree_right[13u8],
            tree_left[14u8],tree_right[14u8],
            root
        ];
    }

    // Compute sibling path (modified to return an array of hash values)
    function compute_sibling_path(tree: [field; 31], leaf_index: u32) -> [field; 5] {
        if leaf_index == 0u32 {
            return [tree[0u32], tree[1u8], tree[17u8], tree[25u8], tree[29u8]];
        } else if leaf_index == 1u32 {
            return [tree[1u32], tree[0u8], tree[17u8], tree[25u8], tree[29u8]];
        } else if leaf_index == 2u32 {
            return [tree[2u32], tree[3u8], tree[16u8], tree[25u8], tree[29u8]];
        } else if leaf_index == 3u32 {
            return [tree[3u32], tree[2u8], tree[16u8], tree[25u8], tree[29u8]];
        } else if leaf_index == 4u32 {
            return [tree[4u32], tree[5u8], tree[19u8], tree[24u8], tree[29u8]];
        } else if leaf_index == 5u32 {
            return [tree[5u32], tree[4u8], tree[19u8], tree[24u8], tree[29u8]];
        } else if leaf_index == 6u32 {
            return [tree[6u32], tree[7u8], tree[18u8], tree[24u8], tree[29u8]];
        } else if leaf_index == 7u32 {
            return [tree[7u32], tree[6u8], tree[18u8], tree[24u8], tree[29u8]];
        } else if leaf_index == 8u32 {
            return [tree[8u32], tree[9u8], tree[21u8], tree[27u8], tree[28u8]];
        } else if leaf_index == 9u32 {
            return [tree[9u32], tree[8u8], tree[21u8], tree[27u8], tree[28u8]];
        } else if leaf_index == 10u32 {
            return [tree[10u32], tree[11u8], tree[20u8], tree[27u8], tree[28u8]];
        } else if leaf_index == 11u32 {
            return [tree[11u32], tree[10u8], tree[20u8], tree[27u8], tree[28u8]];
        } else if leaf_index == 12u32 {
            return [tree[12u32], tree[13u8], tree[23u8], tree[26u8], tree[28u8]];
        } else if leaf_index == 13u32 {
            return [tree[13u32], tree[12u8], tree[23u8], tree[26u8], tree[28u8]];
        } else if leaf_index == 14u32 {
            return [tree[14u32], tree[15u8], tree[22u8], tree[26u8], tree[28u8]];
        } else if leaf_index == 15u32 {
            return [tree[15u32], tree[14u8], tree[22u8], tree[26u8], tree[28u8]];
        }

        return [0field, 0field, 0field, 0field, 0field];
    }

    inline calculate_hash_for_neighbor(sibling1:field, sibling2:field, indexbit: u32) -> field {
        if indexbit == 0u32 {
            return Poseidon4::hash_to_field([sibling1, sibling2]);
        } else {
            return Poseidon4::hash_to_field([sibling2, sibling1]);
        }
    }

    // Inline function to calculate root from siblings (modified to use index for order of hashing)
    function calculate_root_siblings(leaf: field, leaf_index: u32, siblings:[field; 4]) -> (field, field, field) {
        let parent1: field = calculate_hash_for_neighbor(siblings[0u8], siblings[1u8], leaf_index % 2u32);
        let parent2:field = calculate_hash_for_neighbor(parent1, siblings[2u8], (leaf_index / 2u32) % 2u32);
        let root:field = calculate_hash_for_neighbor(parent2, siblings[3u8], (leaf_index / 4u32) % 2u32);
        return (root, parent1, parent2);
    }

}
