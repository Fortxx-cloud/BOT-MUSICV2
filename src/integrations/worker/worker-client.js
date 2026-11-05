export class WorkerClient {
    constructor(bossClient) {
        this.boss = bossClient;
    }

    get configured() {
        return this.boss.configured;
    }

    async list() {
        const result = await this.boss.listWorkers();
        return result.workers || [];
    }

    async get(workerId) {
        const result = await this.boss.getWorker(workerId);
        return result.worker;
    }

    async remove(workerId) {
        return this.boss.removeWorker(workerId);
    }

    async status() {
        try {
            const workers = await this.list();

            const online = workers.filter(
                worker => worker.status === 'online'
            ).length;

            return {
                connected: true,
                total: workers.length,
                online,
                offline: workers.length - online,
                workers
            };
        } catch (error) {
            return {
                connected: false,
                total: 0,
                online: 0,
                offline: 0,
                error: error.message,
                workers: []
            };
        }
    }
}

import { bossClient } from '../boss/boss-client.js';

export const workerClient = new WorkerClient(bossClient);
