import { systemConfig } from '../../config/system.js';

export class BossClient {
    constructor() {
        this.baseUrl = systemConfig.boss.url.replace(/\/+$/, '');
        this.secret = systemConfig.boss.secret;
        this.connected = false;
        this.lastError = null;
    }

    get configured() {
        return Boolean(
            systemConfig.boss.enabled &&
            this.baseUrl &&
            this.secret
        );
    }

    async request(path, options = {}, authenticated = true) {
        if (!this.baseUrl) {
            throw new Error('BOSS_URL belum dikonfigurasi.');
        }

        const headers = {
            Accept: 'application/json',
            ...options.headers
        };

        if (authenticated) {
            if (!this.secret) {
                throw new Error('BOSS_SECRET belum dikonfigurasi.');
            }

            headers.Authorization = `Bearer ${this.secret}`;
        }

        const response = await fetch(
            `${this.baseUrl}${path}`,
            {
                ...options,
                headers,
                signal: AbortSignal.timeout(10000)
            }
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                data.error || `BOSS HTTP ${response.status}`
            );
        }

        return data;
    }

    async health() {
        try {
            const result = await this.request('/health', {}, false);
            this.connected = true;
            this.lastError = null;
            return result;
        } catch (error) {
            this.connected = false;
            this.lastError = error.message;
            throw error;
        }
    }

    async listWorkers() {
        return this.request('/api/workers');
    }

    async getWorker(workerId) {
        return this.request(
            `/api/workers/${encodeURIComponent(workerId)}`
        );
    }

    async removeWorker(workerId) {
        return this.request(
            `/api/workers/${encodeURIComponent(workerId)}`,
            { method: 'DELETE' }
        );
    }

    async getBalancer() {
        return this.request('/api/balancer');
    }

    async enqueueTask({
        type,
        payload = {},
        guildId = null,
        idempotencyKey = null,
        priority = 0,
        maxAttempts,
        delayMs = 0
    }) {
        return this.request('/api/tasks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                type,
                payload,
                guildId,
                idempotencyKey,
                priority,
                maxAttempts,
                delayMs
            })
        });
    }

    async listTasks({ status, limit = 100 } = {}) {
        const params = new URLSearchParams({ limit: String(limit) });

        if (status) params.set('status', status);

        return this.request(`/api/tasks?${params}`);
    }

    async getTask(taskId) {
        return this.request(
            `/api/tasks/${encodeURIComponent(taskId)}`
        );
    }

    status() {
        return {
            configured: this.configured,
            connected: this.connected,
            url: this.baseUrl || null,
            lastError: this.lastError
        };
    }
}

export const bossClient = new BossClient();
