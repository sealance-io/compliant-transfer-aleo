import { ExecutionMode } from "@doko-js/core";
import { BaseContract } from "../contract/base-contract";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

export async function getLatestBlockHeight() {
    const response = await fetch(`${contract.config.network.endpoint}/${contract.config.networkName}/block/height/latest`) as any;
    const latestBlockHeight = await response.json() as number;
    return latestBlockHeight;
}