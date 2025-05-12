/**
 * Jest configuration for TypeScript ESM project
 * @type {import('@jest/types').Config.InitialOptions}
 */
const config = {
  transform: {
    "^.+\\.(t|j)sx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          module: "NodeNext",
          //isolatedModules: true
        },
      },
    ],
  },
  testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  preset: "ts-jest/presets/js-with-ts-esm",
  globalSetup: "./jest.global-setup.js",
  globalTeardown: "./jest.global-teardown.js",
  setupFilesAfterEnv: ["./jest.setup.js"],
  testTimeout: 3000000, // Set large timeout for both test and hooks
  workerThreads: true, // Use Node.js worker threads instead of child processes
  maxWorkers: 2,
  reporters: [
    ["summary", { summaryThreshold: 0 }], // Always print full run summary
  ],
};

export default config;
