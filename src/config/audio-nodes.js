import 'dotenv/config';
import { NodeType } from 'lavalink-client';

const MAX_NODES = 50;

function getNodeConfig(index) {
    const prefix = `AUDIO_NODE_${index}_`;

    const id = process.env[`${prefix}ID`]?.trim();
    const type = process.env[`${prefix}TYPE`]?.trim();
    const uri = process.env[`${prefix}URI`]?.trim();
    const password = process.env[`${prefix}PASSWORD`];
    const priorityValue = process.env[`${prefix}PRIORITY`];

    if (!id && !uri && !password && !type) return null;

    if (!id || !type || !uri || !password) {
        throw new Error(`[AUDIO NODE ${index}] Konfigurasi tidak lengkap.`);
    }

    if (!Object.values(NodeType).includes(type)) {
        throw new Error(`[AUDIO NODE ${index}] TYPE tidak valid.`);
    }

    let parsedUri;

    try {
        parsedUri = new URL(uri);
    } catch {
        throw new Error(`[AUDIO NODE ${index}] URI tidak valid.`);
    }

    if (!['http:', 'https:'].includes(parsedUri.protocol)) {
        throw new Error(`[AUDIO NODE ${index}] Gunakan HTTP atau HTTPS.`);
    }

    const priority = priorityValue ? Number(priorityValue) : index;

    if (!Number.isInteger(priority) || priority < 1) {
        throw new Error(`[AUDIO NODE ${index}] PRIORITY tidak valid.`);
    }

    return {
        id,
        nodeType: type,
        host: parsedUri.hostname,
        port: Number(parsedUri.port) || (parsedUri.protocol === 'https:' ? 443 : 80),
        authorization: password,
        secure: parsedUri.protocol === 'https:',
        retryAmount: 10,
        retryDelay: 5000,
        enablePingOnStatsCheck: true,
        priority
    };
}

export function loadAudioNodes() {
    const nodes = [];

    for (let i = 1; i <= MAX_NODES; i++) {
        const node = getNodeConfig(i);
        if (node) nodes.push(node);
    }

    const ids = nodes.map(node => node.id);

    if (new Set(ids).size !== ids.length) {
        throw new Error('ID Audio Node tidak boleh duplikat.');
    }

    nodes.sort((a, b) => a.priority - b.priority);

    return nodes;
}

export const AUDIO_NODES = loadAudioNodes();
