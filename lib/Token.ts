import { Token_registryContract } from "../artifacts/js/token_registry";
import { IPolicy, ZERO_ADDRESS, mode } from "./Constants";
import { stringToBigInt } from "./Conversion";

export async function registerTokenProgram(
  deployerPrivKey: any,
  deployerAddress: string,
  adminAddress: string,
  { tokenId, tokenName, tokenSymbol, programAddress }: IPolicy,
) {
  const tokenRegistryContract = new Token_registryContract({
    mode,
    privateKey: deployerPrivKey,
  });

  // register token and assign the policy contract as external_authorization_party
  const tokenMetadata = await tokenRegistryContract.registered_tokens(tokenId, {
    token_id: 0n,
    name: 0n,
    symbol: 0n,
    decimals: 0,
    supply: 0n,
    max_supply: 0n,
    admin: ZERO_ADDRESS,
    external_authorization_required: false,
    external_authorization_party: ZERO_ADDRESS,
  });
  if (tokenMetadata.token_id === 0n) {
    const tx = await tokenRegistryContract.register_token(
      tokenId, // tokenId
      stringToBigInt(tokenName), // tokenId
      stringToBigInt(tokenSymbol), // name
      6, // decimals
      1000_000000000000n, // max supply
      true,
      programAddress,
    );
    await tx.wait();
    if (deployerAddress !== adminAddress) {
      const tx = await tokenRegistryContract.update_token_management(tokenId, adminAddress, programAddress);
      await tx.wait();
    }
  } else if (tokenMetadata.external_authorization_party !== programAddress || tokenMetadata.admin !== adminAddress) {
    // if the admin is not the deployer and the admin is already the admin this call will not work
    const tx = await tokenRegistryContract.update_token_management(tokenId, adminAddress, programAddress);
    await tx.wait();
  }
}
