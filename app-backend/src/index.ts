import { ServiceBroker } from 'moleculer';
import dotenv from 'dotenv';
import brokerConfig from '../moleculer.config';
import PostsService from './services/posts.service';
import SuggestionsService from './services/suggestions.service';
import AiService from './services/ai.service';
import ApiGatewayWsService from './services/api-gateway-ws.service';
import AiSettingsService from './services/ai-settings.service';
import prisma from './lib/prisma';

dotenv.config();

async function main(): Promise<void> {
  const broker = new ServiceBroker(brokerConfig);

  broker.createService(PostsService);
  broker.createService(SuggestionsService);
  broker.createService(AiService);
  broker.createService(AiSettingsService);
  broker.createService(ApiGatewayWsService);

  await broker.start();
  broker.logger.info('All services started. Ready.');

  if (process.send) {
    process.send({ type: 'backend:ready' });
  }

  // Graceful shutdown
  const shutdown = async () => {
    broker.logger.info('Shutting down…');
    await broker.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
