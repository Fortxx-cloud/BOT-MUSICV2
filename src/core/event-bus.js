import { EventEmitter } from 'node:events';

class ZomaEventBus extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(100);
    }

    publish(event, payload = {}) {
        this.emit(event, {
            timestamp: Date.now(),
            ...payload
        });
    }

    subscribe(event, handler) {
        this.on(event, handler);

        return () => this.off(event, handler);
    }
}

export const eventBus = new ZomaEventBus();
