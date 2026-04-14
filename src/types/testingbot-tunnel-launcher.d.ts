declare module 'testingbot-tunnel-launcher' {
  interface TunnelOptions {
    apiKey: string;
    apiSecret: string;
    tunnelIdentifier?: string;
    verbose?: boolean;
  }

  interface TunnelInstance {
    close(callback: () => void): void;
  }

  function downloadAndRunAsync(
    options: TunnelOptions,
  ): Promise<TunnelInstance>;
  function killAsync(): Promise<void>;

  export {
    downloadAndRunAsync,
    killAsync,
    TunnelOptions,
    TunnelInstance,
  };
}
