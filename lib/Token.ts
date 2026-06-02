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
      {
        token_id: tokenId,
        name: stringToBigInt(policy.tokenName),
        symbol: stringToBigInt(policy.tokenSymbol),
        decimals: 6,
        max_supply: 1_000_000_000_000_000n,
        external_authorization_required: true,
        external_authorization_party: Leo.address(policy.programAddress),
      },
      asSigner(deployer),
    );
  }

  const currentMetadata = await tokenRegistry.mappings.registeredTokens.get(tokenId);
  if (
    currentMetadata.external_authorization_party !== policy.programAddress ||
    currentMetadata.admin !== admin.address
  ) {
    await tokenRegistry.update_token_management.accepted(
      {
        token_id: tokenId,
        admin,
        external_authorization_party: Leo.address(policy.programAddress),
      },
      asSigner(deployer),
    );
  }
}
