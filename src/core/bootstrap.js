import { systemConfig } from '../config/system.js';
import { logger } from '../utils/logger.js';

import { eventBus } from './event-bus.js';
import { moduleRegistry } from './module-registry.js';
import { serviceManager } from './service-manager.js';
import { healthMonitor } from './health-monitor.js';

import { bossClient } from '../integrations/boss/boss-client.js';
import { workerClient } from '../integrations/worker/worker-client.js';
import { audioManager } from '../audio/index.js';

let started = false;
let monitorTimer = null;
let checking = false;

async function checkSystemHealth(client) {
    if (checking) return;

    checking = true;

    try {
        // DISCORD
        healthMonitor.update('discord', 'online', {
            clientId: client.user.id
        });

        // BOSS
        if (!bossClient.configured) {
            healthMonitor.update('boss', 'disabled');
            serviceManager.setStatus('boss', 'disabled');
        } else {
            try {
                await bossClient.health();

                healthMonitor.update('boss', 'online');
                serviceManager.setStatus('boss', 'online');
            } catch (error) {
                healthMonitor.update('boss', 'offline', {
                    error: error.message
                });

                serviceManager.setStatus('boss', 'offline');
            }

            // WORKERS
            if (bossClient.connected) {
                const result = await workerClient.status();

                if (result.connected) {
                    const status = result.total === 0
                        ? 'waiting'
                        : result.online > 0
                            ? 'online'
                            : 'degraded';

                    healthMonitor.update('worker', status, {
                        total: result.total,
                        online: result.online,
                        offline: result.offline
                    });

                    serviceManager.setStatus('worker', status);

                    eventBus.publish('worker:health', {
                        total: result.total,
                        online: result.online,
                        offline: result.offline
                    });
                } else {
                    healthMonitor.update('worker', 'offline', {
                        error: result.error
                    });

                    serviceManager.setStatus('worker', 'offline');
                }
            } else {
                healthMonitor.update('worker', 'unavailable');
                serviceManager.setStatus('worker', 'unavailable');
            }
        }

        // AUDIO CORE: menunggu integrasi Audio Manager.
        if (systemConfig.audio.enabled) {
            healthMonitor.update('audio', 'waiting');
        } else {
            healthMonitor.update('audio', 'disabled');
        }

        eventBus.publish('system:health', healthMonitor.snapshot());
    } catch (error) {
        logger.error('HEALTH CHECK ERROR', {
            error: error.message
        });
    } finally {
        checking = false;
    }
}

export async function startCore(client) {
    if (started) return;

    logger.info('================================');
    logger.info('ZOMA CORE INITIALIZING');
    logger.info('================================');

    serviceManager.register('boss', bossClient);
    serviceManager.register('worker', workerClient);
    serviceManager.register('events', eventBus);

    for (const component of [
        'discord',
        'boss',
        'worker',
        'audio'
    ]) {
        healthMonitor.register(component);
    }

    healthMonitor.update('discord', 'online', {
        clientId: client.user.id
    });

    moduleRegistry.register('boss', bossClient);
    moduleRegistry.register('worker', workerClient);

    eventBus.publish('core:ready', {
        app: systemConfig.app.name,
        version: systemConfig.app.version
    });

    started = true;

    if (systemConfig.audio.enabled) {
        await audioManager.start(client);
    }
    await checkSystemHealth(client);

    const interval = Math.max(
        5000,
        systemConfig.monitoring.interval || 15000
    );

    if (systemConfig.monitoring.enabled) {
        monitorTimer = setInterval(
            () => checkSystemHealth(client),
            interval
        );

        monitorTimer.unref?.();
    }

    logger.info('ZOMA CORE READY');

    logger.info('SYSTEM STATUS', {
        services: serviceManager.list(),
        health: healthMonitor.snapshot(),
        modules: moduleRegistry.list()
    });
}

export async function stopCore() {
    if (!started) return;

    logger.warn('ZOMA CORE SHUTTING DOWN');

    if (monitorTimer) {
        clearInterval(monitorTimer);
        monitorTimer = null;
    }

    await audioManager.stop();
    await moduleRegistry.shutdown();

    started = false;

    logger.info('ZOMA CORE STOPPED');
}
