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
 * Test a single endpoint and return the result
 */
async function testEndpoint(
  url: string,
  description: string,
): Promise<EndpointResult> {
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

    return {
      endpoint: `${description} (${url})`,
      success: true,
      statusCode: response.status,
      latencyMs,
    };
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

    return {
      endpoint: `${description} (${url})`,
      success: false,
      error: errorMessage,
      latencyMs,
    };
  }
}

/**
 * Check if the system has internet connectivity by testing against
 * multiple reliable third-party endpoints in parallel.
 * Returns as soon as one endpoint succeeds, reducing latency significantly.
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

  // Test all endpoints in parallel
  const endpointPromises = testEndpoints.map(({ url, description }) =>
    testEndpoint(url, description),
  );

  // Use Promise.any to return on first success, or collect all failures
  try {
    // Create promises that only resolve on success
    const successPromises = endpointPromises.map(async (promise) => {
      const result = await promise;
      if (result.success) {
        return result;
      }
      throw result; // Throw failures so Promise.any continues to next
    });

    const successResult = await Promise.any(successPromises);

    return {
      connected: true,
      endpointResults: [successResult],
      message: `Internet connectivity verified via ${successResult.endpoint} (${successResult.latencyMs}ms)`,
    };
  } catch (aggregateError) {
    // All endpoints failed - collect all results
    const endpointResults = await Promise.all(endpointPromises);
    const testedEndpoints = endpointResults.map((r) => r.endpoint).join(', ');

    return {
      connected: false,
      endpointResults,
      message: `No internet connectivity detected. Tested endpoints: ${testedEndpoints}`,
    };
  }
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
