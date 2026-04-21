import Credentials from '../../src/models/credentials';

describe('Credentials', () => {
  it('exposes userName and accessKey via getters', () => {
    const creds = new Credentials('user-123', 'secret-xyz');
    expect(creds.userName).toBe('user-123');
    expect(creds.accessKey).toBe('secret-xyz');
  });

  it('masks accessKey in toString with the same number of asterisks', () => {
    const creds = new Credentials('me', '12345');
    expect(creds.toString()).toBe('me:*****');
  });

  it('masks an empty accessKey as empty', () => {
    const creds = new Credentials('me', '');
    expect(creds.toString()).toBe('me:');
  });

  it('does not expose the raw accessKey via toString', () => {
    const creds = new Credentials('me', 'my-secret');
    expect(creds.toString()).not.toContain('my-secret');
  });
});
