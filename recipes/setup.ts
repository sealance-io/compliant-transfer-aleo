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
  "sealed_report_token",
  "compliant_token_template",
  "multisig_compliant_token",
];

export const setup: DeploymentRecipe = async ctx => {
  const deployer = ctx.named.signer("deployer");
  const admin = ctx.named.signer("admin");
  const freezeListManager = ctx.named.signer("freezeListManager");

  await fundWithCredits(ctx, admin.address, fundedAmount, deployer);
  if (ctx.network === "devnode") {
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
  if (!(await reportPolicy.mappings.freezeListRoot.contains(CURRENT_FREEZE_LIST_ROOT_INDEX))) {
    await reportPolicy.initialize.accepted(admin, policies.report.blockHeightWindow, asSigner(admin));
  }
  if (!(await freezeRegistry.mappings.freezeListRoot.contains(CURRENT_FREEZE_LIST_ROOT_INDEX))) {
    await freezeRegistry.initialize.accepted(admin, BLOCK_HEIGHT_WINDOW, asSigner(deployer));
  }
  if (!(await multisigFreezeRegistry.mappings.freezeListRoot.contains(CURRENT_FREEZE_LIST_ROOT_INDEX))) {
    await multisigFreezeRegistry.initialize.accepted(admin, BLOCK_HEIGHT_WINDOW, zeroAddress, asSigner(admin));
  }
  if (!(await thresholdPolicy.mappings.freezeRegistryProgramName.contains(FREEZE_REGISTRY_PROGRAM_INDEX))) {
    await thresholdPolicy.initialize.accepted(admin, policies.threshold.blockHeightWindow, asSigner(admin));
  }
  if (!(await timelockPolicy.mappings.freezeRegistryProgramName.contains(FREEZE_REGISTRY_PROGRAM_INDEX))) {
    await timelockPolicy.initialize.accepted(admin, asSigner(admin));
  }
  if (!(await exchange.mappings.initialized.contains(true))) {
    await exchange.initialize.accepted(admin, asSigner(admin));
  }
  if (!(await reportToken.mappings.freezeListRoot.contains(CURRENT_FREEZE_LIST_ROOT_INDEX))) {
    await reportToken.initialize.accepted(
      stringToBigInt("Report Token"),
      stringToBigInt("REPORT_TOKEN"),
      6,
      1000_000000000000n,
      admin,
      BLOCK_HEIGHT_WINDOW,
      asSigner(admin),
    );
  }
  if (!(await compliantToken.mappings.tokenInfo.contains(true))) {
    await compliantToken.initialize.accepted(
      stringToBigInt("Stable Token"),
      stringToBigInt("STABLE_TOKEN"),
      6,
      1000_000000000000n,
      admin,
      asSigner(deployer),
    );
  }
  if (!(await multisigCompliantToken.mappings.tokenInfo.contains(true))) {
    await multisigCompliantToken.initialize.accepted(
      stringToBigInt("Stable Token"),
      stringToBigInt("STABLE_TOKEN"),
      6,
      1000_000000000000n,
      admin,
      zeroAddress,
      asSigner(admin),
    );
  }

  // assign exchange program to be a minter
  await tokenRegistry.set_role.accepted(fieldLiteral(policies.report.tokenId), exchange.address(), 1, asSigner(admin));
  await tokenRegistry.set_role.accepted(
    fieldLiteral(policies.threshold.tokenId),
    exchange.address(),
    1,
    asSigner(admin),
  );
  await timelockPolicy.update_role.accepted(exchange.address(), MINTER_ROLE, asSigner(admin));

  // Update the freeze list manager
  await reportPolicy.update_role.accepted(freezeListManager, FREEZELIST_MANAGER_ROLE, asSigner(admin));
  await reportToken.update_role.accepted(freezeListManager, FREEZELIST_MANAGER_ROLE, asSigner(admin));
  await freezeRegistry.update_role.accepted(freezeListManager, FREEZELIST_MANAGER_ROLE, asSigner(admin));
  await multisigFreezeRegistry.update_role.accepted(
    freezeListManager,
    FREEZELIST_MANAGER_ROLE,
    emptyMultisigCommonParams,
    asSigner(admin),
  );
};

export default setup;
