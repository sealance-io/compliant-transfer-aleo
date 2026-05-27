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
  const url = `${ctx.connection.endpoint}/${ctx.connection.networkId}/program/${programName}.aleo/latest_edition`;
  console.log(url);
  const latest_edition = Number(await (await fetch(url)).json());
  return latest_edition;
}

interface DeploymentTransaction {
  deployment: {
    program_checksum: string[]; // e.g., ["123u8", "45u8", ...]
  };
}

export async function getDeployedProgramChecksum(ctx: TestContext, programName: string): Promise<number[]> {
  const baseUrl = `${ctx.connection.endpoint}/${ctx.connection.networkId}`;

  const transactionId: string = (await (
    await fetch(`${baseUrl}/find/transactionID/deployment/${programName}.aleo`)
  ).json()) as string;
  const transactionDetails: DeploymentTransaction = (await (
    await fetch(`${baseUrl}/transaction/${transactionId}`)
  ).json()) as DeploymentTransaction;
  const checksum = transactionDetails.deployment.program_checksum.map((value: string) => parseInt(value, 10));
  return checksum;
}
