import { logger } from '../utils/logger.js';

class ServiceManager {
    constructor() {
        this.services = new Map();
    }

    register(name, service) {
        if (this.services.has(name)) {
            throw new Error(`Service ${name} sudah terdaftar.`);
        }

        this.services.set(name, {
            instance: service,
            status: 'registered'
        });

        logger.info(`SERVICE REGISTERED: ${name}`);
    }

    get(name) {
        return this.services.get(name)?.instance;
    }

    setStatus(name, status) {
        const service = this.services.get(name);

        if (service) {
            service.status = status;
        }
    }

    list() {
        return Object.fromEntries(
            [...this.services.entries()].map(([name, data]) => [
                name,
                data.status
            ])
        );
    }
}

export const serviceManager = new ServiceManager();
