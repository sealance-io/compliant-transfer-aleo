import type { LionDenRuntimeEnvironment } from "@lionden/core";
import type { TestContext } from "@lionden/testing";

type UpgradeRuntime = TestContext | LionDenRuntimeEnvironment;

interface UpgradeProgramOptions {
  generateTypechain?: boolean;
}

function getLre(runtime: UpgradeRuntime): LionDenRuntimeEnvironment {
  return "lre" in runtime ? runtime.lre : runtime;
}

export async function upgradeProgram(
  runtime: UpgradeRuntime,
  programName: string,
  options: UpgradeProgramOptions = {},
) {
  const lre = getLre(runtime);
  const codegen = lre.config.codegen as { enabled: boolean };
  const codegenEnabled = codegen.enabled;
  const generateTypechain = options.generateTypechain ?? false;

  try {
    codegen.enabled = generateTypechain;
    await lre.tasks.run("upgrade", {
      program: programName,
    });
    return true;
  } catch (error) {
    if (error instanceof Error) {
      console.log(`${error.name}: ${error.message}`);
    } else {
      console.log(`Upgrade error: ${String(error)} ${JSON.stringify(error)}`);
    }
    return false;
  } finally {
    codegen.enabled = codegenEnabled;
  }
}

export async function getProgramEdition(ctx: TestContext, programName: string): Promise<number> {
  const edition = await ctx.connection.getProgramEdition(`${programName}.aleo`);
  if (edition === null) {
    throw new Error(`Program ${programName}.aleo is not deployed`);
  }
  return edition;
}

export async function getDeployedProgramChecksum(ctx: TestContext, programName: string): Promise<number[]> {
  const checksum = await ctx.connection.getProgramChecksum(`${programName}.aleo`);
  if (checksum === null) {
    throw new Error(`Program ${programName}.aleo is not deployed`);
  }
  return [...checksum];
}

interface DeploymentTransaction {
  deployment: {
    program_checksum: string[]; // e.g., ["123u8", "45u8", ...]
  };
}
