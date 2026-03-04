import type { BrokerOptions } from 'moleculer';
import dotenv from 'dotenv';

dotenv.config();

const config: BrokerOptions = {
  namespace: process.env.MOLECULER_NAMESPACE || 'text-assistant',
  nodeID: process.env.NODE_ID,

  logger: {
    type: 'Console',
    options: {
      level: process.env.LOG_LEVEL || 'info',
      colors: true,
      moduleColors: true,
      formatter: 'full',
      autoPadding: false,
    },
  },

  // TCP transporter for local dev/single-node; swap for NATS/Redis in prod.
  // Disable UDP discovery by default to avoid multicast warnings on restricted networks.
  transporter: process.env.TRANSPORTER
    ? process.env.TRANSPORTER === 'TCP'
      ? {
          type: 'TCP',
          options: {
            udpDiscovery: process.env.TCP_UDP_DISCOVERY === 'true',
          },
        }
      : process.env.TRANSPORTER
    : {
        type: 'TCP',
        options: {
          udpDiscovery: false,
        },
      },

  // Optional Redis cacher
  cacher: process.env.REDIS_URL
    ? {
        type: 'Redis',
        options: { redis: process.env.REDIS_URL },
      }
    : undefined,

  // Retry policy for action calls
  retryPolicy: {
    enabled: false,
  },

  // Circuit breaker
  circuitBreaker: {
    enabled: true,
    threshold: 0.5,
    minRequestCount: 20,
    windowTime: 60,
    halfOpenTime: 10 * 1000,
  },

  // Request timeout (ms)
  requestTimeout: 10 * 1000,

  errorHandler(err, info) {
    const errObj = err as unknown as { code?: unknown; type?: unknown };
    const statusCode =
      typeof errObj.code === 'number'
        ? errObj.code
        : null;
    const errorType =
      typeof errObj.type === 'string'
        ? errObj.type
        : 'INTERNAL_ERROR';

    // 4xx-like business errors are expected and already returned to callers.
    if (statusCode !== null && statusCode < 500) {
      this.logger.info(`Handled client error [${errorType}]: ${err.message}`);
    } else {
      this.logger.warn('Global error handler caught:', err.message, info);
    }
    throw err;
  },
};

export default config;
