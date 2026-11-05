import { LavalinkManager } from 'lavalink-client';

import { loadAudioNodes } from '../config/audio-nodes.js';
import { systemConfig } from '../config/system.js';
import { logger } from '../utils/logger.js';
import { eventBus } from '../core/event-bus.js';
import { healthMonitor } from '../core/health-monitor.js';

class AudioManager {
    constructor() {
        this.manager = null;
        this.client = null;
        this.started = false;
        this.starting = false;
        this.nodes = [];
        this.nodeStatus = new Map();
        this.lastError = null;
    }

    async start(client) {
        if (this.started) return this.manager;
        if (this.starting) return null;

        if (!systemConfig.audio.enabled) {
            logger.info('AUDIO CORE DISABLED');
            healthMonitor.update('audio', 'disabled');
            return null;
        }

        this.starting = true;
        this.client = client;

        try {
            this.nodes = loadAudioNodes();

            if (this.nodes.length === 0) {
                throw new Error('Belum ada AUDIO NODE yang dikonfigurasi.');
            }

            logger.info('AUDIO CORE INITIALIZING', {
                totalNodes: this.nodes.length,
                failover: systemConfig.audio.failover
            });

            for (const config of this.nodes) {
                this.nodeStatus.set(config.id, {
                    id: config.id,
                    type: config.nodeType,
                    priority: config.priority,
                    status: 'connecting'
                });
            }

            this.manager = new LavalinkManager({
                nodes: this.nodes,

                sendToShard: (guildId, payload) => {
                    const guild = client.guilds.cache.get(guildId);

                    if (guild?.shard) {
                        guild.shard.send(payload);
                        return;
                    }

                    const shardId = client.ws.calculateShardId(guildId);
                    const shard = client.ws.shards.get(shardId);

                    if (shard) {
                        shard.send(payload);
                    }
                },

                client: {
                    id: client.user.id,
                    username: client.user.username
                },

                autoSkip: true,
                autoSkipOnResolveError: true,
                autoMove: systemConfig.audio.failover,

                playerOptions: {
                    applyVolumeAsFilter: false,
                    clientBasedPositionUpdateInterval: 150,
                    defaultSearchPlatform: 'ytmsearch',
                    allowCustomSources: false,
                    useUnresolvedData: true,

                    onDisconnect: {
                        autoReconnect: true,
                        destroyPlayer: false,
                        autoReconnectOnlyWithTracks: true
                    },

                    onEmptyQueue: {
                        destroyAfterMs: 30000
                    }
                },

                queueOptions: {
                    maxPreviousTracks: 25
                },

                advancedOptions: {
                    enableDebugEvents: true,
                    debugOptions: {
                        noAudio: false
                    }
                }
            });

            this.registerEvents();

            await this.manager.init({
                id: client.user.id,
                username: client.user.username
            });

            const connected = this.getConnectedNodes();

            if (connected.length === 0) {
                throw new Error('Tidak ada Audio Node yang berhasil terhubung.');
            }

            this.started = true;
            this.lastError = null;

            this.updateHealth();

            logger.info('AUDIO CORE READY', {
                connectedNodes: connected.length,
                totalNodes: this.nodes.length
            });

            eventBus.publish('audio:ready', this.status());

            return this.manager;

        } catch (error) {
            this.lastError = error.message;

            healthMonitor.update('audio', 'offline', {
                error: error.message
            });

            logger.error('AUDIO CORE START FAILED', {
                error: error.message
            });

            if (this.manager) {
                try {
                    await this.manager.nodeManager.disconnectAll(false, false);
                } catch {}
            }

            this.manager = null;
            this.started = false;

            return null;

        } finally {
            this.starting = false;
        }
    }

    registerEvents() {
        const manager = this.manager;

        manager.on('trackStart', (player, track) => {
            logger.info('TRACK START', {
                guildId: player.guildId,
                title: track?.info?.title || 'Unknown',
                node: player.node?.id
            });

            eventBus.publish('audio:trackStart', {
                guildId: player.guildId,
                track,
                node: player.node?.id
            });
        });

        manager.on('trackEnd', (player, track, payload) => {
            eventBus.publish('audio:trackEnd', {
                guildId: player.guildId,
                track,
                payload
            });
        });

        manager.on('trackStuck', (player, track, payload) => {
            logger.warn('TRACK STUCK', {
                guildId: player.guildId,
                title: track?.info?.title
            });

            eventBus.publish('audio:trackStuck', {
                guildId: player.guildId,
                track,
                payload
            });
        });

        manager.on('trackError', (player, track, payload) => {
            logger.error('TRACK ERROR', {
                guildId: player.guildId,
                title: track?.info?.title,
                payload
            });

            eventBus.publish('audio:trackError', {
                guildId: player.guildId,
                track,
                payload
            });
        });

        manager.on('queueEnd', (player, track, payload) => {
            eventBus.publish('audio:queueEnd', {
                guildId: player.guildId,
                track,
                payload
            });
        });

        manager.on('playerCreate', player => {
            eventBus.publish('audio:playerCreate', {
                guildId: player.guildId
            });
        });

        manager.on('playerDestroy', (player, reason) => {
            eventBus.publish('audio:playerDestroy', {
                guildId: player.guildId,
                reason
            });
        });

        manager.nodeManager.on('connect', node => {
            this.setNodeStatus(node.id, 'online');

            logger.info('AUDIO NODE CONNECTED', {
                id: node.id,
                type: node.nodeType
            });

            this.updateHealth();
        });

        manager.nodeManager.on('disconnect', (node, reason) => {
            this.setNodeStatus(node.id, 'offline', reason);

            logger.warn('AUDIO NODE DISCONNECTED', {
                id: node.id,
                reason
            });

            this.updateHealth();

            eventBus.publish('audio:nodeDisconnect', {
                id: node.id,
                reason
            });
        });

        manager.nodeManager.on('reconnecting', node => {
            this.setNodeStatus(node.id, 'reconnecting');

            logger.warn('AUDIO NODE RECONNECTING', {
                id: node.id
            });

            this.updateHealth();
        });

        manager.nodeManager.on('error', (node, error) => {
            this.setNodeStatus(node.id, 'error', {
                message: error.message
            });

            logger.error('AUDIO NODE ERROR', {
                id: node.id,
                error: error.message
            });

            this.updateHealth();
        });

        manager.nodeManager.on('resumed', (node, payload) => {
            logger.info('AUDIO NODE SESSION RESUMED', {
                id: node.id,
                sessionId: payload.sessionId
            });
        });
    }

    setNodeStatus(id, status, details = null) {
        const previous = this.nodeStatus.get(id) || {};

        this.nodeStatus.set(id, {
            ...previous,
            id,
            status,
            details,
            updatedAt: Date.now()
        });

        eventBus.publish('audio:nodeStatus', {
            id,
            status,
            details
        });
    }

    getConnectedNodes() {
        if (!this.manager) return [];

        return [...this.manager.nodeManager.nodes.values()]
            .filter(node => node.connected);
    }

    getPreferredNode() {
        if (!this.manager) return null;

        const connected = this.getConnectedNodes();

        if (!connected.length) return null;

        const priorities = new Map(
            this.nodes.map(node => [node.id, node.priority])
        );

        return connected.sort(
            (a, b) =>
                (priorities.get(a.id) ?? 999) -
                (priorities.get(b.id) ?? 999)
        )[0];
    }

    updateHealth() {
        const connected = this.getConnectedNodes();
        const total = this.nodes.length;

        const status =
            connected.length === 0 ? 'offline' :
            connected.length === total ? 'online' :
            'degraded';

        healthMonitor.update('audio', status, {
            connected: connected.length,
            total,
            preferredNode: this.getPreferredNode()?.id || null
        });

        eventBus.publish('audio:health', {
            status,
            connected: connected.length,
            total
        });
    }

    sendRawData(packet) {
        if (!this.started || !this.manager) return;

        this.manager.sendRawData(packet).catch(error => {
            logger.error('AUDIO RAW EVENT ERROR', {
                error: error.message
            });
        });
    }

    getPlayer(guildId) {
        return this.manager?.getPlayer(guildId) || null;
    }

    getNode(id) {
        return this.manager?.nodeManager.getNode(id) || null;
    }

    status() {
        const connected = this.getConnectedNodes();

        return {
            enabled: systemConfig.audio.enabled,
            started: this.started,
            totalNodes: this.nodes.length,
            connectedNodes: connected.length,
            preferredNode: this.getPreferredNode()?.id || null,
            players: this.manager?.players.size || 0,
            lastError: this.lastError,
            nodes: [...this.nodeStatus.values()]
        };
    }

    async reconnectAll() {
        if (!this.manager) {
            throw new Error('Audio Manager belum berjalan.');
        }

        return this.manager.nodeManager.reconnectAll();
    }

    async stop() {
        if (!this.manager) return;

        logger.warn('AUDIO CORE SHUTTING DOWN');

        try {
            await this.manager.nodeManager.disconnectAll(false, false);
        } catch (error) {
            logger.error('AUDIO SHUTDOWN ERROR', {
                error: error.message
            });
        }

        this.manager = null;
        this.started = false;

        healthMonitor.update('audio', 'offline');

        logger.info('AUDIO CORE STOPPED');
    }
}

export const audioManager = new AudioManager();
