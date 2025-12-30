/**
 * Error enhancement utilities for better diagnostics
 */

import { AxiosError } from 'axios';
import TestingBotError from '../models/testingbot_error';

/**
 * Enhances generic network errors with more specific diagnostic information
 */
export function enhanceNetworkError(
  error: Error,
  url: string,
): TestingBotError {
  let hostname: string;
  let origin: string;

  try {
    const urlObj = new URL(url);
    hostname = urlObj.hostname;
    origin = urlObj.origin;
  } catch {
    hostname = url;
    origin = url;
  }

  const lines: string[] = [
    `Network request failed: ${url}`,
    '',
    'Possible causes:',
    `  1. No internet connection - check your network connectivity`,
    `  2. DNS resolution failed - unable to resolve "${hostname}"`,
    `  3. Firewall or proxy blocking the request`,
    `  4. API server is down or unreachable`,
    `  5. SSL/TLS certificate validation failed`,
    '',
    'Troubleshooting steps:',
    `  • Check internet connection: ping google.com`,
    `  • Test API reachability: curl ${origin}`,
    `  • Verify API URL is correct: ${origin}`,
    `  • Check for proxy/VPN interference`,
    `  • Try again in a few moments if server is temporarily down`,
    '',
    `Original error: ${error.message}`,
  ];

  return new TestingBotError(lines.join('\n'), { cause: error });
}

/**
 * HTTP status code to user-friendly error message mapping
 */
interface StatusCodeConfig {
  message: string;
  troubleshooting?: string[];
}

const STATUS_CODE_MESSAGES: Record<number, StatusCodeConfig> = {
  400: {
    message: 'Invalid request',
    troubleshooting: [
      'Check that all required parameters are provided',
      'Verify the file format is correct (APK for Android, IPA/ZIP for iOS)',
      'Ensure the request payload is valid',
    ],
  },
  401: {
    message:
      'Invalid TestingBot credentials. Please check your API key and secret',
    troubleshooting: [
      'Run "testingbot login" to authenticate via browser',
      'Use --api-key and --api-secret command line options',
      'Set TB_KEY and TB_SECRET environment variables',
      'Create ~/.testingbot file with content: key:secret',
    ],
  },
  403: {
    message: 'Access denied',
    troubleshooting: [
      'Check your account has the required permissions',
      'Verify your subscription plan includes this feature',
      'Contact support if you believe this is an error',
    ],
  },
  404: {
    message: 'Resource not found',
    troubleshooting: [
      'Verify the resource ID or path is correct',
      'Check if the resource was deleted or expired',
    ],
  },
  429: {
    message: 'Your TestingBot credits are depleted',
    troubleshooting: [
      'Check your remaining credits at https://testingbot.com/members',
      'Upgrade your plan at https://testingbot.com/pricing',
      'Contact support if you believe this is an error',
    ],
  },
  500: {
    message: 'Server error occurred',
    troubleshooting: [
      'This is a temporary issue on our end',
      'Please try again in a few moments',
      'Contact support if the issue persists',
    ],
  },
  502: {
    message: 'Bad gateway - service temporarily unavailable',
    troubleshooting: [
      'The service is experiencing issues',
      'Please try again in a few moments',
    ],
  },
  503: {
    message: 'Service temporarily unavailable',
    troubleshooting: [
      'The service is under maintenance or overloaded',
      'Please try again in a few moments',
    ],
  },
  504: {
    message: 'Gateway timeout',
    troubleshooting: [
      'The request took too long to process',
      'Try with a smaller file or simpler request',
      'Check your network connection speed',
    ],
  },
};

/**
 * Get a user-friendly error message for an HTTP status code
 */
export function getStatusCodeMessage(
  statusCode: number,
  serverMessage?: string,
): string {
  const config = STATUS_CODE_MESSAGES[statusCode];

  if (!config) {
    return serverMessage
      ? `Request failed (HTTP ${statusCode}): ${serverMessage}`
      : `Request failed with HTTP status ${statusCode}`;
  }

  const lines: string[] = [config.message];

  if (serverMessage) {
    lines.push(`Details: ${serverMessage}`);
  }

  if (config.troubleshooting && config.troubleshooting.length > 0) {
    lines.push('');
    lines.push('Troubleshooting:');
    for (const step of config.troubleshooting) {
      lines.push(`  • ${step}`);
    }
  }

  return lines.join('\n');
}

/**
 * Handle Axios errors with enhanced diagnostics
 */
export function handleAxiosError(
  error: AxiosError,
  operation: string,
): TestingBotError {
  // Network-level errors (no response)
  if (!error.response) {
    if (error.code === 'ECONNREFUSED') {
      return new TestingBotError(
        `${operation}: Connection refused. The server may be down or unreachable.\n\n` +
          'Troubleshooting:\n' +
          '  • Check if the API server is running\n' +
          '  • Verify the API URL is correct\n' +
          '  • Check for firewall or proxy issues',
        { cause: error },
      );
    }

    if (error.code === 'ENOTFOUND') {
      return new TestingBotError(
        `${operation}: DNS resolution failed. Could not resolve the server hostname.\n\n` +
          'Troubleshooting:\n' +
          '  • Check your internet connection\n' +
          '  • Verify the API URL is correct\n' +
          '  • Try: ping api.testingbot.com',
        { cause: error },
      );
    }

    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      return new TestingBotError(
        `${operation}: Connection timed out. The request took too long to complete.\n\n` +
          'Troubleshooting:\n' +
          '  • Check your internet connection speed\n' +
          '  • Try again - the server may be temporarily slow\n' +
          '  • For large files, ensure stable connection',
        { cause: error },
      );
    }

    if (
      error.code === 'CERT_HAS_EXPIRED' ||
      error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    ) {
      return new TestingBotError(
        `${operation}: SSL/TLS certificate error.\n\n` +
          'Troubleshooting:\n' +
          '  • Check your system date and time are correct\n' +
          '  • Update your CA certificates\n' +
          '  • Check for proxy/VPN interference',
        { cause: error },
      );
    }

    // Generic network error
    return enhanceNetworkError(error, error.config?.url || 'unknown URL');
  }

  // HTTP errors (have response)
  const statusCode = error.response.status;
  const serverMessage = extractServerMessage(error.response.data);

  return new TestingBotError(
    `${operation}: ${getStatusCodeMessage(statusCode, serverMessage)}`,
    { cause: error },
  );
}

/**
 * Extract error message from various server response formats
 */
function extractServerMessage(data: unknown): string | undefined {
  if (!data) return undefined;

  if (typeof data === 'string') {
    // Try to parse as JSON
    try {
      const parsed = JSON.parse(data);
      return parsed.message || parsed.error || data;
    } catch {
      return data;
    }
  }

  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.error === 'string') return obj.error;
    if (typeof obj.errors === 'string') return obj.errors;
    if (Array.isArray(obj.errors)) return obj.errors.join(', ');
  }

  return undefined;
}

/**
 * Check if an error is a network-level error (vs HTTP error)
 */
export function isNetworkError(error: AxiosError): boolean {
  return !error.response && !!error.code;
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: AxiosError): boolean {
  // Network errors are usually retryable
  if (isNetworkError(error)) {
    return true;
  }

  // Some HTTP errors are retryable
  const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
  return error.response
    ? retryableStatusCodes.includes(error.response.status)
    : false;
}
