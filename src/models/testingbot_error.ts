export default class TestingBotError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TestingBotError';
    Object.setPrototypeOf(this, TestingBotError.prototype);
  }
}
