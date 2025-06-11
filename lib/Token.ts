import { Token_registryContract } from "../artifacts/js/token_registry";
import { IPolicy, ZERO_ADDRESS, mode } from "./Constants";
import { stringToBigInt } from "./Conversion";
import { updateAdminRole, updateInvestigatorRole } from "./Role";

export async function initializeTokenProgram(
  deployerPrivKey: any,
  deployerAddress: string,
  adminPrivKey: any,
  adminAddress: string,
  investigatorAddress: string,
  {
    tokenId,
    tokenName,
    tokenSymbol,
    programAddress,
    Contract,
    initMappings,
    requireInitialization,
    blockHeightWindow,
  }: IPolicy,
) {
  const tokenRegistryContract = new Token_registryContract({
    mode,
    privateKey: deployerPrivKey,
  });

  // register token and assign compliant transfer contract as external_authorization_party
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
  if (requireInitialization) {
    if (tokenMetadata.token_id === 0n) {
      const contract = new Contract({ mode, privateKey: adminPrivKey });
      const tx = await contract.initialize();
      await tx.wait();
    } else if (
      tokenMetadata.admin !== programAddress &&
      tokenMetadata.external_authorization_party !== programAddress
    ) {
      throw new Error(`${tokenId} initialized by another account`);
    }
  } else {
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
    } else if (tokenMetadata.external_authorization_party !== programAddress) {
      // if the admin is not the deployer and the admin is already the admin this call will not work
      const tx = await tokenRegistryContract.update_token_management(tokenId, adminAddress, programAddress);
      await tx.wait();
    }

    const contract = new Contract({ mode, privateKey: adminPrivKey });
    await updateAdminRole(contract, adminAddress);
    await updateInvestigatorRole(contract, investigatorAddress);
  }

  if (initMappings) {
    const contract = new Contract({ mode, privateKey: deployerPrivKey });
    const tx = await contract.init_mappings();
    await tx.wait();
  }
  if (blockHeightWindow) {
    const contract = new Contract({ mode, privateKey: adminPrivKey });
    const tx = await contract.update_block_height_window(blockHeightWindow);
    await tx.wait();
  }
}
