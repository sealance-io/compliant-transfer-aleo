import { exec } from "child_process";
import { promisify } from "util";
import networkConfig from "../aleo-config";

const execAsync = promisify(exec);

export async function upgradeProgram(programName: string, privateKey: string) {
  const networkName = networkConfig.defaultNetwork;
  const endpoint = networkConfig.networks[networkName].endpoint;
  console.log(
    `cd artifacts/leo/${programName} && leo upgrade --broadcast --private-key ${privateKey} --yes --endpoint ${endpoint} --network ${networkName} --blocks-to-check 20 --max-wait 30`,
  );
  const { stdout } = await execAsync(
    `cd artifacts/leo/${programName} && leo upgrade --broadcast --private-key ${privateKey} --yes --endpoint ${endpoint} --network ${networkName} --blocks-to-check 20 --max-wait 30`,
  );
  if (stdout.includes("Upgrade confirmed!")) {
    return true;
  }
  return false;
}

export async function getProgramEdition(programName: string): Promise<number> {
  const endpoint = networkConfig.networks[networkConfig.defaultNetwork].endpoint;
  const networkName = networkConfig.defaultNetwork;
  const url = `${endpoint}/${networkName}/program/${programName}.aleo/latest_edition`;
  console.log(url);
  const latest_edition = Number(await (await fetch(url)).json());
  return latest_edition;
}

interface DeploymentTransaction {
  deployment: {
    program_checksum: string[]; // e.g., ["123u8", "45u8", ...]
  };
}

export async function getDeployedProgramChecksum(programName: string): Promise<number[]> {
  const endpoint = networkConfig.networks[networkConfig.defaultNetwork].endpoint;
  const network = networkConfig.defaultNetwork;
  const baseUrl = `${endpoint}/${network}`;

  const transactionId: string = (await (
    await fetch(`${baseUrl}/find/transactionID/deployment/${programName}.aleo`)
  ).json()) as string;
  const transactionDetails: DeploymentTransaction = (await (
    await fetch(`${baseUrl}/transaction/${transactionId}`)
  ).json()) as DeploymentTransaction;
  const checksum = transactionDetails.deployment.program_checksum.map((value: string) => parseInt(value, 10));
  return checksum;
}
