module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  testMatch: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/*.test.ts",
  ],
  coverageDirectory: "coverage",
  coveragePathIgnorePatterns: ["/node_modules/", "/dist/"],
  coverageReporters: ["text", "lcov", "html"],
  verbose: true,
  moduleNameMapper: {
    "^@opencode-ai/sdk$": "<rootDir>/tests/__mocks__/@opencode-ai/sdk.ts",
  },
};
