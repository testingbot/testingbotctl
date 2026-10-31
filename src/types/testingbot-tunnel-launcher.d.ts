declare module 'testingbot-tunnel-launcher' {
  interface TunnelOptions {
    apiKey: string;
    apiSecret: string;
    tunnelIdentifier?: string;
    verbose?: boolean;
    /** Passed to the tunnel as --proxy host:port. */
    proxy?: string;
    /** Passed to the tunnel as --proxy-userpwd user:password. */
    'proxy-userpwd'?: string;
  }

  interface TunnelInstance {
    close(callback: () => void): void;
  }

  function downloadAndRunAsync(options: TunnelOptions): Promise<TunnelInstance>;
  function killAsync(): Promise<void>;

  export { downloadAndRunAsync, killAsync, TunnelOptions, TunnelInstance };
}
