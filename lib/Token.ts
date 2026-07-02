import { stringToBigInt } from "@sealance-io/policy-engine-aleo";
import { IPolicy } from "./Constants";
import type { SignableNamedAccount } from "@lionden/config";
import { asSigner, fieldLiteral } from "./LiondenAdapters";
import { createTokenRegistry } from "../typechain/TokenRegistry";
import { Leo } from "../typechain/BaseContract";

export async function registerTokenProgram(
  tokenRegistry: ReturnType<typeof createTokenRegistry>,
  deployer: SignableNamedAccount,
  admin: SignableNamedAccount,
  policy: IPolicy,
) {
  const tokenId = fieldLiteral(policy.tokenId);
  const isRegistered = await tokenRegistry.mappings.registeredTokens.contains(tokenId);

  if (!isRegistered) {
    await tokenRegistry.register_token.accepted(
      tokenId,
      stringToBigInt(policy.tokenName),
      stringToBigInt(policy.tokenSymbol),
      6,
      1_000_000_000_000_000n,
      true,
      Leo.address(policy.programAddress),
      asSigner(deployer),
    );
  }

  const currentMetadata = await tokenRegistry.mappings.registeredTokens.get(tokenId);
  if (
    currentMetadata.external_authorization_party !== policy.programAddress ||
    currentMetadata.admin !== admin.address
  ) {
    await tokenRegistry.update_token_management.accepted(
      tokenId,
      admin,
      Leo.address(policy.programAddress),
      asSigner(deployer),
    );
  }
}
