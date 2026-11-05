import 'dotenv/config';

const required = ['DISCORD_TOKEN', 'CLIENT_ID'];

for (const key of required) {
    if (!process.env[key]) {
        throw new Error(`Environment variable ${key} belum diatur.`);
    }
}

export const env = {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    nodeEnv: process.env.NODE_ENV || 'development'
};
