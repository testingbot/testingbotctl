import packageJson from '../package.json';
export default {
  getUserAgent(): string {
    return `TestingBot-CTL-${packageJson.version}`;
  },
};
