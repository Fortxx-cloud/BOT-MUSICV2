import {
    Client,
    GatewayIntentBits
} from 'discord.js';

import { env } from './config/env.js';
import { systemConfig } from './config/system.js';
import { startCore, stopCore } from './core/index.js';
import { logger } from './utils/logger.js';
import { audioManager } from './audio/index.js';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

client.once('clientReady', async readyClient => {
    logger.info('================================');
    logger.info('ZOMA APP V2 ONLINE');
    logger.info('================================');

    logger.info('BOT IDENTITY', {
        bot: readyClient.user.tag,
        clientId: readyClient.user.id,
        runtime: process.version
    });

    await startCore(readyClient);

    logger.info('================================');
});

client.on('raw', packet => {
    // Audio Manager akan menerima voice packets pada tahap integrasi.
});

client.on('error', error => {
    logger.error('DISCORD ERROR', {
        message: error.message
    });
});

process.on('unhandledRejection', error => {
    logger.error('UNHANDLED REJECTION', {
        message: error?.message || String(error)
    });
});

process.on('SIGINT', async () => {
    await stopCore();
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await stopCore();
    client.destroy();
    process.exit(0);
});

logger.info('STARTING ZOMA APP', {
    environment: systemConfig.app.environment
});

await client.login(env.token);
