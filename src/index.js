import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';

import { env } from './config/env.js';
import { systemConfig } from './config/system.js';
import { startCore, stopCore } from './core/index.js';
import { logger } from './utils/logger.js';
import { audioManager } from './audio/index.js';
import { localAudio } from './audio/local-playback.js';
import { searchCommand } from './commands/search.js';
import { handleInteraction } from './handlers/interaction-handler.js';

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

    await localAudio.initialize();
    await startCore(readyClient);

    const rest = new REST({ version: '10' }).setToken(env.token);

    try {
        await rest.put(
            Routes.applicationCommands(env.clientId),
            { body: [searchCommand.toJSON()] }
        );

        logger.info('SLASH COMMANDS REGISTERED', {
            commands: ['search']
        });
    } catch (error) {
        logger.error('SLASH COMMAND REGISTRATION FAILED', {
            error: error.message
        });
    }

    logger.info('================================');
});

client.on('interactionCreate', handleInteraction);

client.on('raw', packet => {
    audioManager.sendRawData(packet);
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
    await localAudio.stopAll();
    await stopCore();
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await localAudio.stopAll();
    await stopCore();
    client.destroy();
    process.exit(0);
});

logger.info('STARTING ZOMA APP', {
    environment: systemConfig.app.environment
});

await client.login(env.token);
