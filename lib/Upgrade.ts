import { exec } from "child_process";
import { promisify } from "util";
import networkConfig from "../aleo-config";

const execAsync = promisify(exec);

export async function upgradeProgram(programName: string, privateKey: string) {
  const endpoint = networkConfig.networks[networkConfig.defaultNetwork].endpoint;
  const networkName = networkConfig.defaultNetwork;
  const isDevnet = endpoint.includes("localhost");
  console.log(
    `cd artifacts/leo/${programName} && leo upgrade --broadcast ${isDevnet ? "--devnet" : ""} --private-key ${privateKey} --yes --endpoint ${endpoint} --network ${networkName}`,
  );
  const { stdout } = await execAsync(
    `cd artifacts/leo/${programName} && leo upgrade --broadcast ${isDevnet ? "--devnet" : ""} --private-key ${privateKey} --yes --endpoint ${endpoint} --network ${networkName}`,
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
