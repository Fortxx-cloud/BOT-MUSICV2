const levels = {
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
    DEBUG: 'DEBUG'
};

function write(level, message, data) {
    const timestamp = new Date().toISOString();
    const extra = data ? ` ${JSON.stringify(data)}` : '';

    console.log(`[${timestamp}] [${level}] ${message}${extra}`);
}

export const logger = {
    info: (message, data) => write(levels.INFO, message, data),
    warn: (message, data) => write(levels.WARN, message, data),
    error: (message, data) => write(levels.ERROR, message, data),
    debug: (message, data) => {
        if (process.env.NODE_ENV !== 'production') {
            write(levels.DEBUG, message, data);
        }
    }
};
