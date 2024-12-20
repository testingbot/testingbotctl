module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        isolatedModules: true, // This is an example option; you can adjust based on your needs
      },
    ],
  },
  testMatch: ['**/tests/**/*.test.ts'], // Adjust this based on your test folder structure
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  globals: {
    'ts-jest': {
      isolatedModules: true, // Helps for faster builds
    },
  },
};
