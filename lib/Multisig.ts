import { AddressInput, Leo, LeoField } from "../typechain/BaseContract";
import { MultisigCommonParams } from "../typechain/MultisigCompliantToken";
import { asSigner, scalarLiteral } from "./LiondenAdapters";
import { createMultisigCore } from "../typechain/MultisigCore";
import { type SignableNamedAccount } from "@lionden/config";
import { type TestContext } from "@lionden/testing";
import { zeroAddress } from "./Constants";

export function multisigCommonParams(walletId: ReturnType<typeof Leo.address>, salt: bigint): MultisigCommonParams {
  return {
    wallet_id: walletId,
    salt: scalarLiteral(salt),
  };
}

export function randomSalt() {
  return BigInt(Math.floor(Math.random() * 100000));
}

export async function initializeMultisig(
  multisig: ReturnType<typeof createMultisigCore>,
  deployer: SignableNamedAccount,
) {
  if (!(await multisig.mappings.programSettingsMap.contains(true))) {
    await multisig.init.accepted(
      {
        upgrader_address: deployer,
        guard_create_wallet: false,
      },
      asSigner(deployer),
    );
  }
}

export async function createWallet(
  multisig: ReturnType<typeof createMultisigCore>,
  deployer: SignableNamedAccount,
  walletId: ReturnType<typeof Leo.address>,
  aleoSigners: ReadonlyArray<AddressInput> = [zeroAddress, zeroAddress, zeroAddress, zeroAddress],
  threshold = 2,
  ecdsaSigners = Array.from({ length: 4 }, () => Array(20).fill(0)),
) {
  if (!(await multisig.mappings.walletsMap.contains(walletId))) {
    await multisig.create_wallet.accepted(
      {
        wallet_id: walletId,
        threshold,
        aleo_signers: aleoSigners,
        ecdsa_signers: ecdsaSigners,
      },
      asSigner(deployer),
    );
  }
}

export async function approveRequest(
  ctx: TestContext,
  signers: SignableNamedAccount[],
  walletId: ReturnType<typeof Leo.address>,
  signingOpId: LeoField,
) {
  const multisigCore = createMultisigCore().connect(ctx.lre);

  for (const signer of signers) {
    await multisigCore.sign.accepted(
      {
        wallet_id: walletId,
        signing_op_id: signingOpId,
      },
      asSigner(signer),
    );
  }
}
