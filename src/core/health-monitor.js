class HealthMonitor {
    constructor() {
        this.components = new Map();
    }

    register(name) {
        this.components.set(name, {
            status: 'starting',
            lastCheck: Date.now(),
            details: null
        });
    }

    update(name, status, details = null) {
        this.components.set(name, {
            status,
            lastCheck: Date.now(),
            details
        });
    }

    get(name) {
        return this.components.get(name);
    }

    snapshot() {
        return Object.fromEntries(this.components);
    }
}

export const healthMonitor = new HealthMonitor();
