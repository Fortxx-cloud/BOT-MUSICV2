import 'dotenv/config';

function bool(value, fallback = false) {
    if (value === undefined || value === '') return fallback;
    return value.toLowerCase() === 'true';
}

export const systemConfig = Object.freeze({
    app: {
        name: process.env.APP_NAME || 'ZOMA APP',
        version: process.env.APP_VERSION || '2.0.0',
        environment: process.env.NODE_ENV || 'development'
    },

    boss: {
        enabled: bool(process.env.BOSS_ENABLED),
        url: process.env.BOSS_URL || '',
        secret: process.env.BOSS_SECRET || ''
    },

    worker: {
        enabled: bool(process.env.WORKER_ENABLED),
        id: process.env.WORKER_ID || '',
        secret: process.env.WORKER_SECRET || ''
    },

    audio: {
        enabled: bool(process.env.AUDIO_ENABLED, true),
        failover: bool(process.env.AUDIO_FAILOVER, true)
    },

    monitoring: {
        enabled: bool(process.env.HEALTH_MONITOR_ENABLED, true),
        interval: Number(process.env.HEALTH_CHECK_INTERVAL || 15000)
    }
});
