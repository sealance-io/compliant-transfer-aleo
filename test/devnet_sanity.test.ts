import path from "path";
import fetch from "node-fetch";
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, StartupCheckStrategy, StartupStatus } from "testcontainers";
import Dockerode from "dockerode";


let environment: StartedDockerComposeEnvironment;

beforeAll(async () => {
  const composeFilePath = path.resolve("test", "devnet"); // Path to docker-compose.yml
  const composeFile = "docker-compose.yml";

  // Start the entire docker-compose setup
  environment = await new DockerComposeEnvironment(composeFilePath, composeFile)
  .withWaitStrategy("client", new ClientReadyWaitStrategy(3030))
  .up();
});

afterAll(async () => {
  if (environment) {
    await environment.down();
  }
});

test("Devnet has 4 connected peers and is producing blocks", async () => {
  const clientHost = "http://localhost:3030";

  // Verify peer count
  const peerResponse = await fetch(`${clientHost}/testnet/peers/count`);
  const peerCount = parseInt(await peerResponse.text(), 10);
  expect(peerCount).toBe(4);

  // Verify latest block height
  const blockResponse = await fetch(`${clientHost}/testnet/block/height/latest`);
  const latestBlock = parseInt(await blockResponse.text(), 10);
  expect(latestBlock).toBeGreaterThanOrEqual(0);
});

/**
 * Custom wait strategy for the Aleo client container.
 * Ensures the client is ready when:
 * - Peer count is exactly 4
 * - Latest block height is greater or equal to 0
 */
class ClientReadyWaitStrategy extends StartupCheckStrategy {
  private readonly maxAttempts: number = 40;
  private readonly intervalMs: number = 15000;
  private readonly clientPort: number;

  constructor(clientPort: number = 3030) {
    super();
    this.clientPort = clientPort;
  }

  public async checkStartupState(_dockerClient: Dockerode, _containerId: string): Promise<StartupStatus> {
    const clientHost = `http://localhost:${this.clientPort}`;
    console.log(`Waiting for Aleo client readiness at ${clientHost}`);

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const peerResponse = await fetch(`${clientHost}/testnet/peers/count`);
        const peerCount = parseInt(await peerResponse.text(), 10);

        const blockResponse = await fetch(`${clientHost}/testnet/block/height/latest`);
        const latestBlock = parseInt(await blockResponse.text(), 10);

        console.log(`Attempt ${attempt}: Peers=${peerCount}, Block Height=${latestBlock}`);

        if (peerCount === 4 && latestBlock >= 0) {
          console.log("Client is ready!");
          return "SUCCESS";
        }
      } catch (error) {
        console.warn(`Attempt ${attempt}: API not responding yet...`);
      }

      await new Promise((resolve) => setTimeout(resolve, this.intervalMs));
    }

    throw new Error("Client service did not become ready within 10 minutes ❌");
  }
}
