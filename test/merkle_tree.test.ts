import { ExecutionMode } from "@doko-js/core";
import { Rediwsozfo_v2Contract } from "../artifacts/js/rediwsozfo_v2";
import { MAX_TREE_SIZE, timeout } from "../lib/Constants";
import { getSiblingPath } from "../lib/FreezeList";
import { deployIfNotDeployed } from "../lib/Deploy";
import { buildTree, genLeaves } from "../lib/MerkleTree";
import { Account} from "@provablehq/sdk";
import { convertAddressToField } from "../lib/Conversion";

const mode = ExecutionMode.SnarkExecute;
const contract = new Rediwsozfo_v2Contract({ mode });

describe('merkle tree lib', () => {
    describe('buildTree', () => {
        it('should build a valid tree with 2 leaves', async () => {
            const leaves = ['1field', '2field'];
            const tree = await buildTree(leaves);
            expect(tree).toHaveLength(3);
        });

        it('should build a valid tree with 4 leaves', async () => {
            const leaves = ['1field', '2field', '3field', '4field'];
            const tree = await buildTree(leaves);
            expect(tree).toHaveLength(7);
        });

        it('should throw error for empty leaves', async () => {
            try {
                await buildTree([]);
                fail('Should have thrown error');
            } catch (e) {
                expect(e.message).toBe('Leaves array cannot be empty');
            }
        });

        it('should throw error for odd number of leaves', async () => {
            try {
                await buildTree(['1field', '2field', '3field']);
                fail('Should have thrown error');
            } catch (e) {
                expect(e.message).toBe('Leaves array must have even number of elements');
            }
        });
    });

    describe('genLeaves', () => {
        it('should generate correct number of leaves for given depth', () => {
            const leaves = ['aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px', 'aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t'];
            const depth = 2;
            const result = genLeaves(leaves, depth);
            expect(result).toHaveLength(4);
        });

        it('should pad with 0field when needed', () => {
            const leaves = ['aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px'];
            const depth = 2;
            const result = genLeaves(leaves, depth);
            expect(result).toHaveLength(4);
            expect(result.filter(x => x === '0field').length).toBe(3);
        });

        it('should sort leaves correctly', () => {
            const leaves = ['aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t', 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px'];
            const depth = 1;
            const result = genLeaves(leaves, depth);
            expect(result.length).toBe(2);
            expect(result[0]).not.toBe(result[1]);
        });
    });
});

describe('merkle_tree program tests', () => {
  test(`deploy program`, async () => {
    await deployIfNotDeployed(contract);
  }, timeout);

  test(`large tree random test`, async () => {
    const depth = 12;
    const size = 2**depth;
    const leaves = Array(size).fill(null).map(() => new Account().address().to_string());

    const sortedLeaves = await genLeaves(leaves, depth);
    const tree = await buildTree(sortedLeaves);

    const checked_address = new Account().address().to_string();
    const checked_field = convertAddressToField(checked_address).toString() + "field";
    const checked_bint = BigInt(checked_field.slice(0, -"field".length));

    let leftLeafIndex: number;
    let rightLeafIndex: number;
    
    if (checked_bint < tree[0]) {
      leftLeafIndex = rightLeafIndex = 0;
    } else if (checked_bint > tree[size - 1]) {
      leftLeafIndex = rightLeafIndex = size - 1;
    } else {
    for (let i = 0; i < sortedLeaves.length - 1; i++) {
      if (checked_bint > tree[i] && checked_bint < tree[i + 1]) {
        leftLeafIndex = i;
        rightLeafIndex = i + 1;
        break;
      }
    }
  } 

    const merkle_proof0 = getSiblingPath(tree, leftLeafIndex, MAX_TREE_SIZE);
    const merkle_proof1 = getSiblingPath(tree, rightLeafIndex, MAX_TREE_SIZE);

    //console.log("merkle_proof0", merkle_proof0);
    
    await contract.verify_non_inclusion(checked_address, [merkle_proof0, merkle_proof1]);
  }, timeout)

  test(`merkletree8 tests`, async () => {
    let full_tree = [
      1565094002048987966125128114218933620874510144159086078616679945232957141036n,
      3259351732026142027719932724039004649691434068110420986360942494195629324413n,
      3497515231305803693837120773317097436475212960078744411529609984793410296109n,
      4774482536618622119890422620547469067786875514689069539884104154206344546677n,
      5626528367204237816808701483272855909794694193296912613299770748029601802052n,
      6151714743675486572414059137845786038777442950925037160596915616827525016668n,
      6206971592706614630250305560824186297136958272462501002153397946389817438013n,
      7011000677844567747126892226576640886643148745331859149501017954208554402806n,
      3561454509323834342600701315066753320358416336106341712808677391909237405777n,
      4634969393678244431781520224695937326947138332379824278110141569035623199051n,
      3743413975742015622237347695537050081268906336384248447259679584024278158716n,
      7750151802739255065002097762436572479149015656039742600013395472859654410338n,
      2640674867584502616734175773671204964022374292644024728346851001760279522321n,
      2080670057803057035984478725857899450450640303132064986335589665679687596892n,
      5522068419655646538277363166405777584917413407807564140634215150837651370579n
    ];
    const merkle_proof0 = getSiblingPath(full_tree, 0, MAX_TREE_SIZE);
    const merkle_proof2 = getSiblingPath(full_tree, 2, MAX_TREE_SIZE);
    const merkle_proof3 = getSiblingPath(full_tree, 3, MAX_TREE_SIZE);
    const merkle_proof7 = getSiblingPath(full_tree, 7, MAX_TREE_SIZE);

    await contract.verify_non_inclusion("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px", [merkle_proof2, merkle_proof3]);
    await contract.verify_non_inclusion("aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t", [merkle_proof0, merkle_proof0]);
    await contract.verify_non_inclusion("aleo16k94hj5nsgxpgnnk9u6580kskgucqdadzekmlmvccp25frwd8qgqvn9p9t", [merkle_proof7, merkle_proof7]);

  }, timeout)

  test(`merkletree16 tests`, async () => {
    let full_tree = [
      0n,
      0n,
      0n,
      0n,
      0n,
      0n,
      0n,
      1295133970529764960316948294624974168921228814652993007266766481909235735940n,
      1565094002048987966125128114218933620874510144159086078616679945232957141036n,
      3259351732026142027719932724039004649691434068110420986360942494195629324413n,
      3497515231305803693837120773317097436475212960078744411529609984793410296109n,
      4774482536618622119890422620547469067786875514689069539884104154206344546677n,
      5626528367204237816808701483272855909794694193296912613299770748029601802052n,
      6151714743675486572414059137845786038777442950925037160596915616827525016668n,
      6206971592706614630250305560824186297136958272462501002153397946389817438013n,
      7011000677844567747126892226576640886643148745331859149501017954208554402806n,
      7233124799133753665783241350706390908532988676951941973288057571394699151001n,
      7233124799133753665783241350706390908532988676951941973288057571394699151001n,
      7233124799133753665783241350706390908532988676951941973288057571394699151001n,
      2165428802710870030919491368052814434519902047566197240511215483722594177019n,
      3561454509323834342600701315066753320358416336106341712808677391909237405777n,
      4634969393678244431781520224695937326947138332379824278110141569035623199051n,
      3743413975742015622237347695537050081268906336384248447259679584024278158716n,
      7750151802739255065002097762436572479149015656039742600013395472859654410338n,
      7822411032087215168387560245346361886681254888990385820703325605692676632905n,
      6538570399938344215238224378683530797606373560458809620071916172557648426168n,
      2640674867584502616734175773671204964022374292644024728346851001760279522321n,
      2080670057803057035984478725857899450450640303132064986335589665679687596892n,
      7908795476962746868796914815800637850744954624605800661292329270029867098179n,
      5522068419655646538277363166405777584917413407807564140634215150837651370579n,
      603366662573338348172198587371734088890711748448429624039274257001129839063n
    ];
    const merkle_proof10 = getSiblingPath(full_tree, 10, MAX_TREE_SIZE);
    const merkle_proof11 = getSiblingPath(full_tree, 11, MAX_TREE_SIZE);
    const merkle_proof15 = getSiblingPath(full_tree, 15, MAX_TREE_SIZE);

    await contract.verify_non_inclusion("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px", [merkle_proof10, merkle_proof11]);
    await contract.verify_non_inclusion("aleo16k94hj5nsgxpgnnk9u6580kskgucqdadzekmlmvccp25frwd8qgqvn9p9t", [merkle_proof15, merkle_proof15]);
  }, timeout)

  test(`happy path`, async () => {
    const leaves = await genLeaves([
      "aleo193cgzzpr5lcwq6rmzq4l2ctg5f4mznead080mclfgrc0e5k0w5pstfdfps",
      "aleo104ur4csap6qp3fguddw3mn7f6ddpfkn4clqzzkyjhxmw5j46xsrse6vt5f",
      "aleo194vjp7nt6pwgpruw3kz5fk5kvj9ur6sg2f4k84fqu6cpgq5xhvrs7emymc",
      "aleo1wkyn0ax8nhftfxn0hkx8kgh46yxqla7tzd6z77jhcf5wne6z3c9qnxl2l4",
      "aleo1g3n6k74jx5zzxndnxjzvpgt0zwce93lz00305lycyvayfyyqwqxqxlq7ma",
      "aleo1tjkv7vquk6yldxz53ecwsy5csnun43rfaknpkjc97v5223dlnyxsglv7nm",
      "aleo18khmhg2nehxxsm6km43ah7qdudjkjw7mgpsfya9vvzx3vlq9hyxs8vzdds",
      "aleo17mp7lz72e7zhvzyj8u2szrts2r98vz37sd6z9w500s99aaq4sq8s34vgv9",
    ], 3)
    const tree = await buildTree(leaves);

    const merkle_proof0 = getSiblingPath(tree, 0, MAX_TREE_SIZE);
    const merkle_proof2 = getSiblingPath(tree, 2, MAX_TREE_SIZE);
    const merkle_proof3 = getSiblingPath(tree, 3, MAX_TREE_SIZE);
    const merkle_proof4 = getSiblingPath(tree, 4, MAX_TREE_SIZE);
    const merkle_proof7 = getSiblingPath(tree, 7, MAX_TREE_SIZE);

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
    await expect(contract.verify_non_inclusion("aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t", [{ siblings: merkle_proof2.siblings, leaf_index: 1 }, merkle_proof4])).rejects.toThrow();

    //  invalid right path
    await expect(contract.verify_non_inclusion("aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t", [merkle_proof2, { siblings: merkle_proof3.siblings, leaf_index: 1 },])).rejects.toThrow();

    // the most left address
    await expect(contract.verify_non_inclusion("aleo193cgzzpr5lcwq6rmzq4l2ctg5f4mznead080mclfgrc0e5k0w5pstfdfps", [merkle_proof0, merkle_proof0])).rejects.toThrow();
    await contract.verify_non_inclusion("aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t", [merkle_proof0, merkle_proof0]);

    // the most right address
    await expect(contract.verify_non_inclusion("aleo17mp7lz72e7zhvzyj8u2szrts2r98vz37sd6z9w500s99aaq4sq8s34vgv9", [merkle_proof7, merkle_proof7])).rejects.toThrow();
    await contract.verify_non_inclusion("aleo16k94hj5nsgxpgnnk9u6580kskgucqdadzekmlmvccp25frwd8qgqvn9p9t", [merkle_proof7, merkle_proof7]);

  }, timeout)
})