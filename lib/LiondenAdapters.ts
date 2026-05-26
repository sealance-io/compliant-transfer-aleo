import type { SignableNamedAccount } from "@lionden/config";
import { Leo } from "../typechain/BaseContract.js";
import type { MerkleProof } from "../typechain/MerkleTree.js";

export function fieldLiteral(value: bigint | number | string) {
  if (typeof value === "string" && value.endsWith("field")) {
    return Leo.field(value);
  }
  return Leo.field(`${value.toString()}field`);
}

export function addressLiteral(value: string | { readonly address: string }) {
  return Leo.address(value);
}

export function scalarLiteral(value: bigint | number) {
  return Leo.scalar(`${value.toString()}scalar`);
}

export function toMerkleProof(proof: { siblings: bigint[]; leaf_index: number }): MerkleProof {
  return {
    siblings: proof.siblings.map(sibling => fieldLiteral(sibling)),
    leaf_index: proof.leaf_index,
  };
}

export function asSigner(signer: SignableNamedAccount) {
  return { signer } as const;
}
