export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    "^.+\\.(t|j)sx?$": [
      'ts-jest',
      {
        useESM: true,
        isolatedModules: true  // This disables type checking
      },
    ],
  },
  testEnvironment: 'node',       // Specifically for Node.js environment
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$',
  setupFilesAfterEnv: ["./test.config.js"],
  testTimeout: 3000000,
}