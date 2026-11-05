import { logger } from '../utils/logger.js';

class ModuleRegistry {
    constructor() {
        this.modules = new Map();
    }

    register(name, module) {
        if (!name || !module) {
            throw new Error('Module name dan instance wajib tersedia.');
        }

        if (this.modules.has(name)) {
            throw new Error(`Module ${name} sudah terdaftar.`);
        }

        this.modules.set(name, module);

        logger.info(`MODULE REGISTERED: ${name}`);
    }

    get(name) {
        return this.modules.get(name);
    }

    has(name) {
        return this.modules.has(name);
    }

    list() {
        return [...this.modules.keys()];
    }

    async shutdown() {
        for (const [name, module] of this.modules) {
            if (typeof module.shutdown === 'function') {
                try {
                    await module.shutdown();
                    logger.info(`MODULE STOPPED: ${name}`);
                } catch (error) {
                    logger.error(`MODULE STOP ERROR: ${name}`, {
                        message: error.message
                    });
                }
            }
        }
    }
}

export const moduleRegistry = new ModuleRegistry();
