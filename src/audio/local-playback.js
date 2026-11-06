import {
    createAudioPlayer,
    createAudioResource,
    joinVoiceChannel,
    entersState,
    VoiceConnectionStatus,
    AudioPlayerStatus,
    NoSubscriberBehavior,
    StreamType
} from '@discordjs/voice';

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { logger } from '../utils/logger.js';

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

const CACHE_DIR =
    process.env.ZOMA_AUDIO_CACHE_DIR ||
    path.join(os.tmpdir(), 'zoma-audio-cache');

const MAX_FILE_MB = Number(process.env.ZOMA_MAX_DOWNLOAD_MB || 100);
const DOWNLOAD_TIMEOUT = Number(
    process.env.ZOMA_DOWNLOAD_TIMEOUT_MS || 180000
);

const MAX_QUEUE = 20;

class LocalPlaybackEngine {
    constructor() {
        this.sessions = new Map();
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;

        await fs.mkdir(CACHE_DIR, { recursive: true });

        const files = await fs.readdir(CACHE_DIR);

        for (const file of files) {
            await fs.rm(path.join(CACHE_DIR, file), {
                recursive: true,
                force: true
            });
        }

        this.initialized = true;

        logger.info('LOCAL PLAYBACK ENGINE READY', {
            cacheDir: CACHE_DIR,
            ytdlp: YTDLP,
            ffmpeg: FFMPEG
        });
    }

    async removeFile(file) {
        if (!file) return;

        await fs.rm(file, { force: true }).catch(error => {
            logger.warn('AUDIO FILE CLEANUP FAILED', {
                file: path.basename(file),
                error: error.message
            });
        });
    }

    runDownload(uri, outputTemplate, onProgress) {
        return new Promise((resolve, reject) => {
            const args = [
                '--no-playlist',
                '--no-part',
                '--no-warnings',
                '--newline',
                '--max-filesize',
                `${MAX_FILE_MB}M`,
                '-f',
                'bestaudio/best',
                '-o',
                outputTemplate,
                uri
            ];

            const process = spawn(YTDLP, args, {
                stdio: ['ignore', 'ignore', 'pipe']
            });

            let stderr = '';
            let lastProgress = -10;
            let settled = false;

            const timer = setTimeout(() => {
                process.kill('SIGKILL');
                finish(new Error('Download timeout.'));
            }, DOWNLOAD_TIMEOUT);

            const finish = error => {
                if (settled) return;
                settled = true;

                clearTimeout(timer);

                if (error) reject(error);
                else resolve();
            };

            process.stderr.on('data', chunk => {
                const output = chunk.toString();
                stderr = (stderr + output).slice(-4000);

                const matches = [...output.matchAll(/(\d+(?:\.\d+)?)%/g)];

                if (matches.length && onProgress) {
                    const percent = Math.floor(Number(matches.at(-1)[1]));
                    const milestone = Math.floor(percent / 10) * 10;

                    if (milestone >= lastProgress + 10 || milestone === 100) {
                        lastProgress = milestone;
                        onProgress(Math.min(milestone, 100));
                    }
                }
            });

            process.once('error', error => {
                finish(new Error(
                    `Tidak bisa menjalankan yt-dlp: ${error.message}`
                ));
            });

            process.once('close', code => {
                if (code !== 0) {
                    finish(new Error(
                        `yt-dlp gagal (${code}): ${stderr.slice(-1000)}`
                    ));
                    return;
                }

                finish();
            });
        });
    }

    async download(track, onProgress) {
        const info = track.info || {};

        const uri = info.uri ||
            (
                info.identifier && info.sourceName === 'youtube'
                    ? `https://www.youtube.com/watch?v=${info.identifier}`
                    : null
            );

        if (!uri || !/^https?:\/\//i.test(uri)) {
            throw new Error('URL sumber audio tidak tersedia.');
        }

        const id = randomUUID();
        const template = path.join(CACHE_DIR, `${id}.%(ext)s`);

        logger.info('AUDIO DOWNLOAD START', {
            title: info.title,
            source: info.sourceName
        });

        await this.runDownload(uri, template, onProgress);

        const files = await fs.readdir(CACHE_DIR);
        const filename = files.find(file => file.startsWith(`${id}.`));

        if (!filename) {
            throw new Error('File hasil download tidak ditemukan.');
        }

        const file = path.join(CACHE_DIR, filename);
        const stat = await fs.stat(file);

        if (!stat.isFile() || stat.size === 0) {
            await this.removeFile(file);
            throw new Error('File audio kosong atau tidak valid.');
        }

        if (stat.size > MAX_FILE_MB * 1024 * 1024) {
            await this.removeFile(file);
            throw new Error('Ukuran audio melewati batas cache.');
        }

        logger.info('AUDIO DOWNLOAD COMPLETE', {
            title: info.title,
            sizeMB: Number(stat.size / 1024 / 1024).toFixed(2)
        });

        return file;
    }

    async getSession(guild, voiceChannelId) {
        const guildId = guild.id;
        let session = this.sessions.get(guildId);

        if (session) {
            if (session.voiceChannelId !== voiceChannelId) {
                throw new Error(
                    'Bot sedang digunakan di voice channel lain.'
                );
            }

            return session;
        }

        const connection = joinVoiceChannel({
            guildId,
            channelId: voiceChannelId,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: true,
            selfMute: false
        });

        await entersState(
            connection,
            VoiceConnectionStatus.Ready,
            20000
        );

        const player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Pause
            }
        });

        const created = {
            guildId,
            voiceChannelId,
            connection,
            player,
            queue: [],
            current: null,
            finishing: false,
            processing: false
        };

        connection.subscribe(player);

        connection.on('error', error => {
            logger.error('LOCAL VOICE CONNECTION ERROR', {
                guildId,
                error: error.message
            });
        });

        player.on(AudioPlayerStatus.Idle, () => {
            void this.finishCurrent(created);
        });

        player.on('error', error => {
            logger.error('LOCAL AUDIO PLAYER ERROR', {
                guildId,
                error: error.message
            });

            void this.finishCurrent(created);
        });

        this.sessions.set(guildId, created);

        logger.info('LOCAL VOICE CONNECTED', { guildId });

        return created;
    }

    async enqueue({ guild, voiceChannelId, track, onProgress }) {
        await this.initialize();

        const session = await this.getSession(guild, voiceChannelId);

        if (session.queue.length >= MAX_QUEUE) {
            throw new Error('Antrean lokal sudah mencapai batas.');
        }

        const file = await this.download(track, onProgress);

        session.queue.push({
            id: randomUUID(),
            file,
            track
        });

        logger.info('LOCAL TRACK QUEUED', {
            guildId: guild.id,
            title: track.info?.title,
            queueLength: session.queue.length
        });

        void this.playNext(session);

        return {
            queueLength: session.queue.length,
            title: track.info?.title
        };
    }

    async playNext(session) {
        if (
            session.processing ||
            session.current ||
            !session.queue.length
        ) {
            return;
        }

        session.processing = true;

        const item = session.queue.shift();
        session.current = item;

        try {
            const ffmpeg = spawn(FFMPEG, [
                '-hide_banner',
                '-loglevel', 'error',
                '-i', item.file,
                '-vn',
                '-f', 's16le',
                '-ar', '48000',
                '-ac', '2',
                '-af',
                'loudnorm=I=-11:TP=-2:LRA=9,bass=g=6:f=85:w=0.7,equalizer=f=250:t=q:w=1:g=-1.5,equalizer=f=4500:t=q:w=1:g=2.5,alimiter=limit=0.95:level=false',
                'pipe:1'
            ], {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            item.ffmpeg = ffmpeg;

            ffmpeg.stderr.on('data', chunk => {
                const message = chunk.toString().trim();

                if (message) {
                    logger.warn('FFMPEG OUTPUT', {
                        guildId: session.guildId,
                        message: message.slice(0, 500)
                    });
                }
            });

            ffmpeg.once('error', error => {
                logger.error('FFMPEG PROCESS ERROR', {
                    guildId: session.guildId,
                    error: error.message
                });
            });

            const resource = createAudioResource(ffmpeg.stdout, {
                inputType: StreamType.Raw,
                metadata: {
                    title: item.track.info?.title
                }
            });

            session.player.play(resource);

            logger.info('LOCAL TRACK START', {
                guildId: session.guildId,
                title: item.track.info?.title
            });

        } catch (error) {
            logger.error('LOCAL PLAYBACK FAILED', {
                guildId: session.guildId,
                error: error.message
            });

            session.current = null;

            if (item.ffmpeg && !item.ffmpeg.killed) {
                item.ffmpeg.kill('SIGKILL');
            }

            await this.removeFile(item.file);
        } finally {
            session.processing = false;
        }

        if (!session.current) {
            void this.playNext(session);
        }
    }

    async finishCurrent(session) {
        if (session.finishing || !session.current) return;

        session.finishing = true;

        const item = session.current;
        session.current = null;

        if (item.ffmpeg && !item.ffmpeg.killed) {
            item.ffmpeg.kill('SIGKILL');
        }

        await this.removeFile(item.file);

        logger.info('LOCAL TRACK CLEANED', {
            guildId: session.guildId,
            title: item.track.info?.title
        });

        session.finishing = false;

        void this.playNext(session);
    }

    async stopGuild(guildId) {
        const session = this.sessions.get(guildId);

        if (!session) return;

        this.sessions.delete(guildId);

        session.player.stop(true);

        if (session.current) {
            if (session.current.ffmpeg) {
                session.current.ffmpeg.kill('SIGKILL');
            }

            await this.removeFile(session.current.file);
        }

        for (const item of session.queue) {
            await this.removeFile(item.file);
        }

        session.connection.destroy();

        logger.info('LOCAL PLAYBACK STOPPED', { guildId });
    }

    async stopAll() {
        for (const guildId of [...this.sessions.keys()]) {
            await this.stopGuild(guildId);
        }
    }

    status(guildId) {
        const session = this.sessions.get(guildId);

        if (!session) return null;

        return {
            playing: session.current?.track.info?.title || null,
            queued: session.queue.length,
            voiceChannelId: session.voiceChannelId
        };
    }
}

export const localAudio = new LocalPlaybackEngine();
