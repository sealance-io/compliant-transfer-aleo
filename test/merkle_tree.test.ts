import { ExecutionMode } from "@doko-js/core";
import { Merkle_tree8Contract } from "../artifacts/js/merkle_tree8";

const mode = ExecutionMode.SnarkExecute;
const contract = new Merkle_tree8Contract({ mode });

const account = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"
const ZERO_ADDRESS = "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t"


describe('blocklist test', () => {
  test(`deploy merkle_tree8`, async () => {
    const tx = await contract.deploy();
    await tx.wait();
  }, 10000000)

  test(`update block list`, async () => {
    const tx = await contract.update_list([
    "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
    "aleo193cgzzpr5lcwq6rmzq4l2ctg5f4mznead080mclfgrc0e5k0w5pstfdfps",
    "aleo194vjp7nt6pwgpruw3kz5fk5kvj9ur6sg2f4k84fqu6cpgq5xhvrs7emymc",
    "aleo1wkyn0ax8nhftfxn0hkx8kgh46yxqla7tzd6z77jhcf5wne6z3c9qnxl2l4",
    "aleo1g3n6k74jx5zzxndnxjzvpgt0zwce93lz00305lycyvayfyyqwqxqxlq7ma",
    "aleo1tjkv7vquk6yldxz53ecwsy5csnun43rfaknpkjc97v5223dlnyxsglv7nm",
    "aleo17mp7lz72e7zhvzyj8u2szrts2r98vz37sd6z9w500s99aaq4sq8s34vgv9",
    "aleo16k94hj5nsgxpgnnk9u6580kskgucqdadzekmlmvccp25frwd8qgqvn9p9t"]);

    const result =  await tx.wait();;
    console.log(result)
  }, 10000000)

  test(`happy path`, async () => {
    const tx = await contract.build_tree([
      "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
      "aleo193cgzzpr5lcwq6rmzq4l2ctg5f4mznead080mclfgrc0e5k0w5pstfdfps",
      "aleo194vjp7nt6pwgpruw3kz5fk5kvj9ur6sg2f4k84fqu6cpgq5xhvrs7emymc",
      "aleo1wkyn0ax8nhftfxn0hkx8kgh46yxqla7tzd6z77jhcf5wne6z3c9qnxl2l4",
      "aleo1g3n6k74jx5zzxndnxjzvpgt0zwce93lz00305lycyvayfyyqwqxqxlq7ma",
      "aleo1tjkv7vquk6yldxz53ecwsy5csnun43rfaknpkjc97v5223dlnyxsglv7nm",
      "aleo17mp7lz72e7zhvzyj8u2szrts2r98vz37sd6z9w500s99aaq4sq8s34vgv9",
      "aleo16k94hj5nsgxpgnnk9u6580kskgucqdadzekmlmvccp25frwd8qgqvn9p9t"
    ]);

    const [result] =  await tx.wait();

    const tx2 = await contract.compute_sibling_path(result, 2);
    const [merkle_proof2] =  await tx2.wait();

    const tx3 = await contract.compute_sibling_path(result, 3);
    const [merkle_proof3] =  await tx3.wait();

    const tx4 = await contract.verify_non_inclusion("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px", [merkle_proof2, merkle_proof3]);
    const res = await tx4.wait();

    const tx5 = await contract.compute_sibling_path(result, 4);
    const [merkle_proof4] =  await tx5.wait();

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

  }, 10000000)

  test(`remove address`, async () => {
    const tx = await contract.build_tree([
      ZERO_ADDRESS,
      "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
      "aleo193cgzzpr5lcwq6rmzq4l2ctg5f4mznead080mclfgrc0e5k0w5pstfdfps",
      "aleo194vjp7nt6pwgpruw3kz5fk5kvj9ur6sg2f4k84fqu6cpgq5xhvrs7emymc",
      "aleo1wkyn0ax8nhftfxn0hkx8kgh46yxqla7tzd6z77jhcf5wne6z3c9qnxl2l4",
      "aleo1g3n6k74jx5zzxndnxjzvpgt0zwce93lz00305lycyvayfyyqwqxqxlq7ma",
      "aleo1tjkv7vquk6yldxz53ecwsy5csnun43rfaknpkjc97v5223dlnyxsglv7nm",
      "aleo17mp7lz72e7zhvzyj8u2szrts2r98vz37sd6z9w500s99aaq4sq8s34vgv9",  
    ]);
    const [tree] =  await tx.wait();
    console.log(tree)

  }, 10000000)

  test(`add address`, async () => {
    const tx = await contract.build_tree([
      "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
      "aleo193cgzzpr5lcwq6rmzq4l2ctg5f4mznead080mclfgrc0e5k0w5pstfdfps",
      "aleo194vjp7nt6pwgpruw3kz5fk5kvj9ur6sg2f4k84fqu6cpgq5xhvrs7emymc",
      "aleo1wkyn0ax8nhftfxn0hkx8kgh46yxqla7tzd6z77jhcf5wne6z3c9qnxl2l4",
      "aleo1g3n6k74jx5zzxndnxjzvpgt0zwce93lz00305lycyvayfyyqwqxqxlq7ma",
      "aleo1tjkv7vquk6yldxz53ecwsy5csnun43rfaknpkjc97v5223dlnyxsglv7nm",
      "aleo17mp7lz72e7zhvzyj8u2szrts2r98vz37sd6z9w500s99aaq4sq8s34vgv9",
      "aleo16k94hj5nsgxpgnnk9u6580kskgucqdadzekmlmvccp25frwd8qgqvn9p9t"
    ]);
    const [tree] =  await tx.wait();
    console.log(tree)

  }, 10000000)

})