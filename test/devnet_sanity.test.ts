import fetch from "node-fetch";
import { GenericContainer, StartedTestContainer, StartupCheckStrategy, StartupStatus } from "testcontainers";
import Dockerode from "dockerode";
import * as util from 'util';
import { exec } from "child_process";
const execAsync = util.promisify(exec);

let amareleo: StartedTestContainer;

beforeAll(async () => {
amareleo = await new GenericContainer("ghcr.io/sealance-io/amareleo-chain:latest")
.withExposedPorts({
  container: 3030,
  host: 3030
})
.withWaitStrategy(new AmareleoReadyWaitStrategy(3030))
.start();
});

afterAll(async () => {
  if (amareleo) {
    await amareleo.stop();
  }
});

test("yada yada yada", async () => {
  const clientHost = "http://localhost:3030";

  // Verify latest block height
  const blockResponse = await fetch(`${clientHost}/testnet/block/height/latest`);
  const latestBlock = parseInt(await blockResponse.text(), 10);
  expect(latestBlock).toBeGreaterThanOrEqual(0);
});

/**
 * Custom wait strategy for the Amareleo chain container.
 * Ensures the client is ready when:
 * - Latest block height is greater or equal to 0
 */
class AmareleoReadyWaitStrategy extends StartupCheckStrategy {
  private readonly maxAttempts: number = 40;
  private readonly intervalMs: number = 15000;
  private readonly clientPort: number;

  constructor(clientPort: number = 3030) {
    super();
    this.clientPort = clientPort;
  }

  public async checkStartupState(_dockerClient: Dockerode, _containerId: string): Promise<StartupStatus> {
    const inspection = await execAsync(`docker inspect' ${_containerId}`, 
      { encoding: 'utf8' })
    console.dir(inspection.stdout);

    const clientHost = `http://localhost:${this.clientPort}`;
    console.log(`Waiting for Amareleo node readiness at ${clientHost}`);

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {

        const blockResponse = await fetch(`${clientHost}/testnet/block/height/latest`);
        const latestBlock = parseInt(await blockResponse.text(), 10);

        console.log(`Attempt ${attempt}: Block Height=${latestBlock}`);

        if (latestBlock >= 0) {
          console.log("Amareleo is ready!");
          return "SUCCESS";
        }
      } catch (error) {
        console.debug(error);
        console.warn(`Attempt ${attempt}: API not responding yet...`);
      }

      await new Promise((resolve) => setTimeout(resolve, this.intervalMs));
    }

    throw new Error("Amareleo node did not become ready within 10 minutes ❌");
  }
}
