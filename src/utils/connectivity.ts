/**
 * Utility for checking internet connectivity using third-party endpoints
 */

export interface EndpointResult {
  endpoint: string;
  success: boolean;
  statusCode?: number;
  latencyMs: number;
  error?: string;
}

export interface ConnectivityCheckResult {
  connected: boolean;
  endpointResults: EndpointResult[];
  message: string;
}

/**
 * Check if the system has internet connectivity by testing against
 * multiple reliable third-party endpoints with detailed diagnostics.
 */
export async function checkInternetConnectivity(): Promise<ConnectivityCheckResult> {
  const testEndpoints = [
    { url: 'https://www.google.com/generate_204', description: 'Google' },
    {
      url: 'https://www.cloudflare.com/cdn-cgi/trace',
      description: 'Cloudflare',
    },
    { url: 'https://1.1.1.1/', description: 'Cloudflare DNS' },
  ];

  const endpointResults: EndpointResult[] = [];
  let anySuccess = false;

  for (const { url, description } of testEndpoints) {
    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'manual',
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;

      if (response) {
        anySuccess = true;
        endpointResults.push({
          endpoint: `${description} (${url})`,
          success: true,
          statusCode: response.status,
          latencyMs,
        });
        break;
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      let errorMessage = 'Unknown error';

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = 'Request timeout (>3s)';
        } else if (error.message.includes('fetch failed')) {
          errorMessage = 'Network request failed (DNS/connection error)';
        } else if (error.message.includes('ENOTFOUND')) {
          errorMessage = 'DNS resolution failed';
        } else if (error.message.includes('ECONNREFUSED')) {
          errorMessage = 'Connection refused';
        } else if (error.message.includes('ETIMEDOUT')) {
          errorMessage = 'Connection timeout';
        } else if (error.message.includes('ENETUNREACH')) {
          errorMessage = 'Network unreachable';
        } else {
          errorMessage = error.message;
        }
      }

      endpointResults.push({
        endpoint: `${description} (${url})`,
        success: false,
        error: errorMessage,
        latencyMs,
      });
    }
  }

  let message: string;
  if (anySuccess) {
    const successfulEndpoint = endpointResults.find((r) => r.success);
    message = `Internet connectivity verified via ${successfulEndpoint?.endpoint} (${successfulEndpoint?.latencyMs}ms)`;
  } else {
    const testedEndpoints = endpointResults.map((r) => r.endpoint).join(', ');
    message = `No internet connectivity detected. Tested endpoints: ${testedEndpoints}`;
  }

  return {
    connected: anySuccess,
    endpointResults,
    message,
  };
}

/**
 * Format connectivity check results for display
 */
export function formatConnectivityResults(
  result: ConnectivityCheckResult,
): string {
  const lines: string[] = [];

  if (result.connected) {
    lines.push(`✓ ${result.message}`);
  } else {
    lines.push(`✗ ${result.message}`);
    lines.push('');
    lines.push('Endpoint results:');
    for (const endpoint of result.endpointResults) {
      lines.push(
        `  • ${endpoint.endpoint}: ${endpoint.error} (${endpoint.latencyMs}ms)`,
      );
    }
    lines.push('');
    lines.push('Troubleshooting steps:');
    lines.push('  1. Check your internet connection');
    lines.push('  2. Verify no firewall is blocking outbound connections');
    lines.push('  3. Check if a VPN or proxy is interfering');
    lines.push('  4. Try: ping google.com');
  }

  return lines.join('\n');
}
