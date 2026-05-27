import type { DeploymentRecipe } from "@lionden/plugin-deploy";
import {
  BLOCK_HEIGHT_WINDOW,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  emptyMultisigCommonParams,
  FREEZE_REGISTRY_PROGRAM_INDEX,
  FREEZELIST_MANAGER_ROLE,
  fundedAmount,
  MINTER_ROLE,
  policies,
  zeroAddress,
} from "../lib/Constants.js";
import { fundWithCredits } from "../lib/Fund.js";
import { registerTokenProgram } from "../lib/Token.js";
import { createTokenRegistry } from "../typechain/TokenRegistry.js";
import { createSealedTimelockPolicy } from "../typechain/SealedTimelockPolicy.js";
import { createSealanceFreezelistRegistry } from "../typechain/SealanceFreezelistRegistry.js";
import { createSealedReportToken } from "../typechain/SealedReportToken.js";
import { createSealedReportPolicy } from "../typechain/SealedReportPolicy.js";
import { createSealedThresholdReportPolicy } from "../typechain/SealedThresholdReportPolicy.js";
import { createGqrfmwbtyp } from "../typechain/Gqrfmwbtyp.js";
import { createMultisigCompliantToken } from "../typechain/MultisigCompliantToken.js";
import { createMultisigFreezelistRegistry } from "../typechain/MultisigFreezelistRegistry.js";
import { createCompliantTokenTemplate } from "../typechain/CompliantTokenTemplate.js";
import { asSigner, fieldLiteral } from "../lib/LiondenAdapters.js";
import { stringToBigInt } from "@sealance-io/policy-engine-aleo";
import { Address } from "@provablehq/sdk";
import { Leo } from "../typechain/BaseContract.js";

const PROGRAMS = [
  "token_registry",
  "merkle_tree",
  "multisig_core",
  "sealed_report_policy",
  "sealance_freezelist_registry",
  "multisig_freezelist_registry",
  "sealed_threshold_report_policy",
  "sealed_timelock_policy",
  "gqrfmwbtyp",
  "report_token",
  "compliant_token_template",
  "multisig_compliant_token",
];

export const setup: DeploymentRecipe = async ctx => {
  const deployer = ctx.named.signer("deployer");
  const admin = ctx.named.signer("admin");
  const freezeListManager = ctx.named.signer("freezeListManager");

  if (ctx.network === "devnode") {
    await fundWithCredits(ctx, admin.address, fundedAmount, deployer);
    await fundWithCredits(ctx, freezeListManager.address, fundedAmount, deployer);
  }

  for (const program of PROGRAMS) {
    await ctx.deploy(program, { noCompile: true });
  }

  const tokenRegistry = createTokenRegistry().connect(ctx.lre);
  const timelockPolicy = createSealedTimelockPolicy().connect(ctx.lre);
  const exchange = createGqrfmwbtyp().connect(ctx.lre);
  const compliantToken = createCompliantTokenTemplate().connect(ctx.lre);
  const freezeRegistry = createSealanceFreezelistRegistry().connect(ctx.lre);
  const multisigCompliantToken = createMultisigCompliantToken().connect(ctx.lre);
  const multisigFreezeRegistry = createMultisigFreezelistRegistry().connect(ctx.lre);
  const reportPolicy = createSealedReportPolicy().connect(ctx.lre);
  const reportToken = createSealedReportToken().connect(ctx.lre);
  const thresholdPolicy = createSealedThresholdReportPolicy().connect(ctx.lre);

  await registerTokenProgram(tokenRegistry, deployer, admin, policies.report);
  await registerTokenProgram(tokenRegistry, deployer, admin, policies.threshold);

  // initialize programs
  if ((await reportPolicy.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX)) === null) {
    await reportPolicy.initialize.accepted(
      {
        admin,
        blocks: policies.report.blockHeightWindow,
      },
      asSigner(admin),
    );
  }
  if ((await freezeRegistry.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX)) === null) {
    await freezeRegistry.initialize.accepted(
      {
        admin,
        blocks: BLOCK_HEIGHT_WINDOW,
      },
      asSigner(deployer),
    );
  }
  if ((await multisigFreezeRegistry.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX)) === null) {
    await multisigFreezeRegistry.initialize.accepted(
      {
        admin,
        blocks: BLOCK_HEIGHT_WINDOW,
        manager_wallet_id: zeroAddress,
      },
      asSigner(admin),
    );
  }
  if ((await thresholdPolicy.getFreeze_registry_program_name(FREEZE_REGISTRY_PROGRAM_INDEX)) === null) {
    await thresholdPolicy.initialize.accepted(
      {
        admin,
        blocks: policies.threshold.blockHeightWindow,
      },
      asSigner(admin),
    );
  }
  if ((await timelockPolicy.getFreeze_registry_program_name(FREEZE_REGISTRY_PROGRAM_INDEX)) === null) {
    await timelockPolicy.initialize.accepted({ admin }, asSigner(admin));
  }
  if ((await exchange.getInitialized(true)) === null) {
    await exchange.initialize.accepted({ admin }, asSigner(admin));
  }
  if ((await reportToken.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX)) === null) {
    await reportToken.initialize.accepted(
      {
        name: stringToBigInt("Report Token"),
        symbol: stringToBigInt("REPORT_TOKEN"),
        decimals: 6,
        max_supply: 1000_000000000000n,
        admin,
        blocks: BLOCK_HEIGHT_WINDOW,
      },
      asSigner(admin),
    );
  }
  if ((await compliantToken.getToken_info(true)) === null) {
    await compliantToken.initialize.accepted(
      {
        name: stringToBigInt("Stable Token"),
        symbol: stringToBigInt("STABLE_TOKEN"),
        decimals: 6,
        max_supply: 1000_000000000000n,
        admin,
      },
      asSigner(deployer),
    );
  }
  if ((await multisigCompliantToken.getToken_info(true)) === null) {
    await multisigCompliantToken.initialize.accepted(
      {
        name: stringToBigInt("Stable Token"),
        symbol: stringToBigInt("STABLE_TOKEN"),
        decimals: 6,
        max_supply: 1000_000000000000n,
        admin,
        manager_wallet_id: zeroAddress,
      },
      asSigner(deployer),
    );
  }

  // assign exchange program to be a minter
  const exchangeProgramAddress = Leo.address(Address.fromProgramId("gqrfmwbtyp.aleo").to_string());
  await tokenRegistry.set_role.accepted(
    {
      token_id: fieldLiteral(policies.report.tokenId),
      account: exchangeProgramAddress,
      role: 1,
    },
    asSigner(admin),
  );
  await tokenRegistry.set_role.accepted(
    {
      token_id: fieldLiteral(policies.threshold.tokenId),
      account: exchangeProgramAddress,
      role: 1,
    },
    asSigner(admin),
  );
  await timelockPolicy.update_role.accepted(
    {
      new_address: exchangeProgramAddress,
      role: MINTER_ROLE,
    },
    asSigner(admin),
  );

  // Update the freeze list manager
  await reportPolicy.update_role.accepted(
    {
      new_address: freezeListManager,
      role: FREEZELIST_MANAGER_ROLE,
    },
    asSigner(admin),
  );
  await reportToken.update_role.accepted(
    {
      new_address: freezeListManager,
      role: FREEZELIST_MANAGER_ROLE,
    },
    asSigner(admin),
  );
  await freezeRegistry.update_role.accepted(
    {
      new_address: freezeListManager,
      role: FREEZELIST_MANAGER_ROLE,
    },
    asSigner(admin),
  );
  await multisigFreezeRegistry.update_role.accepted(
    {
      new_address: freezeListManager,
      role: FREEZELIST_MANAGER_ROLE,
      multisig_common_params: emptyMultisigCommonParams,
    },
    asSigner(admin),
  );
};

export default setup;
