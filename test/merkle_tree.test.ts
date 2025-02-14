import { ExecutionMode } from "@doko-js/core";
import { Merkle_tree8Contract } from "../artifacts/js/merkle_tree8";
import { compileFunction } from "vm";

const mode = ExecutionMode.SnarkExecute;
const contract = new Merkle_tree8Contract({ mode });

const account = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"
const ZERO_ADDRESS = "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t"


function getSiblingPath(tree, leafIndex) {
  let num_leaves = Math.floor((tree.length + 1)/2);
  const siblingPath = [];
  
  let index = leafIndex;
  let parentIndex = num_leaves;
  siblingPath.push(tree[index]);
  let level = 1;
  while (parentIndex < tree.length) {
      let siblingIndex = (index % 2 === 0) ? index + 1 : index - 1;  // Get the sibling index
      siblingPath.push(tree[siblingIndex]);
      
      index = parentIndex + Math.floor(leafIndex/2**level);  // Move up to the parent node
      parentIndex += Math.floor(num_leaves/2**level);  // Halve the number of nodes for the next level
      level++;
    }
 
  return {siblings:siblingPath, leaf_index: leafIndex};
}

function stringToBigInt(asciiString) {
  let bigIntValue = 0n;
  for (let i = 0; i < asciiString.length; i++) {
    bigIntValue = (bigIntValue << 8n) + BigInt(asciiString.charCodeAt(i));
  }
  return bigIntValue;
}

describe('merkle_tree8 tests', () => {

  test(`deploy merkle_tree8`, async () => {

    const tokenName = "SEALEDTOKEN";
    console.log(stringToBigInt(tokenName));

    //const tx = await contract.deploy();
    //await tx.wait();
  }, 10000000)

 /* test(`happy path`, async () => {
    let tx = await contract.build_tree([
      //"aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
      "aleo193cgzzpr5lcwq6rmzq4l2ctg5f4mznead080mclfgrc0e5k0w5pstfdfps",
      "aleo104ur4csap6qp3fguddw3mn7f6ddpfkn4clqzzkyjhxmw5j46xsrse6vt5f",
      "aleo194vjp7nt6pwgpruw3kz5fk5kvj9ur6sg2f4k84fqu6cpgq5xhvrs7emymc",
      "aleo1wkyn0ax8nhftfxn0hkx8kgh46yxqla7tzd6z77jhcf5wne6z3c9qnxl2l4",
      "aleo1g3n6k74jx5zzxndnxjzvpgt0zwce93lz00305lycyvayfyyqwqxqxlq7ma",
      "aleo1tjkv7vquk6yldxz53ecwsy5csnun43rfaknpkjc97v5223dlnyxsglv7nm",
      "aleo18khmhg2nehxxsm6km43ah7qdudjkjw7mgpsfya9vvzx3vlq9hyxs8vzdds",
      "aleo17mp7lz72e7zhvzyj8u2szrts2r98vz37sd6z9w500s99aaq4sq8s34vgv9",
      //"aleo16k94hj5nsgxpgnnk9u6580kskgucqdadzekmlmvccp25frwd8qgqvn9p9t"
    ]);

    const [result] =  await tx.wait();
    console.log(result);

    const merkle_proof0 = getSiblingPath(result, 0);
    const merkle_proof2 = getSiblingPath(result, 2);
    const merkle_proof3 = getSiblingPath(result, 3);
    const merkle_proof4 = getSiblingPath(result, 4);
    const merkle_proof7 = getSiblingPath(result, 7);
    
    await contract.verify_non_inclusion("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px", [merkle_proof2, merkle_proof3]);

    // the siblings indices are not adjusted
    await expect(contract.verify_non_inclusion("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px", [merkle_proof2, merkle_proof4])).rejects.toThrow();
    
    // the address is in the list
    await expect(contract.verify_non_inclusion("aleo193cgzzpr5lcwq6rmzq4l2ctg5f4mznead080mclfgrc0e5k0w5pstfdfps", [merkle_proof2, merkle_proof3])).rejects.toThrow();
    
    // the address is not in a provided range (large)
    await expect(contract.verify_non_inclusion("aleo16k94hj5nsgxpgnnk9u6580kskgucqdadzekmlmvccp25frwd8qgqvn9p9t", [merkle_proof2, merkle_proof3])).rejects.toThrow();

    //  the address is not in a provided range (smaller)
    await expect(contract.verify_non_inclusion("aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t", [merkle_proof2, merkle_proof3])).rejects.toThrow();

    //  invalid left path
    await expect(contract.verify_non_inclusion("aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t", [{siblings: merkle_proof2.siblings, leaf_index:1}, merkle_proof4])).rejects.toThrow();

    //  invalid right path
    await expect(contract.verify_non_inclusion("aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t", [merkle_proof2, {siblings: merkle_proof3.siblings, leaf_index:1}, ])).rejects.toThrow();

    // the most left address
    await expect(contract.verify_non_inclusion("aleo193cgzzpr5lcwq6rmzq4l2ctg5f4mznead080mclfgrc0e5k0w5pstfdfps", [merkle_proof0, merkle_proof0])).rejects.toThrow();
    await contract.verify_non_inclusion("aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t", [merkle_proof0, merkle_proof0]);

    // the most right address
    await expect(contract.verify_non_inclusion("aleo17mp7lz72e7zhvzyj8u2szrts2r98vz37sd6z9w500s99aaq4sq8s34vgv9", [merkle_proof7, merkle_proof7])).rejects.toThrow();
    await contract.verify_non_inclusion("aleo16k94hj5nsgxpgnnk9u6580kskgucqdadzekmlmvccp25frwd8qgqvn9p9t", [merkle_proof7, merkle_proof7]);
    
  }, 10000000)*/
})