import {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    MessageFlags
} from 'discord.js';

import { randomUUID } from 'node:crypto';
import { audioManager } from '../audio/index.js';
import { localAudio } from '../audio/local-playback.js';
import { logger } from '../utils/logger.js';

const pendingSearches = new Map();
const SEARCH_TIMEOUT = 60_000;

async function searchConnectedNodes(query, botId, requester) {
    const configs = audioManager.nodes || [];
    const connected = audioManager.getConnectedNodes()
        .sort((a, b) => {
            const pa = configs.find(n => n.id === a.id)?.priority ?? 999;
            const pb = configs.find(n => n.id === b.id)?.priority ?? 999;
            return pa - pb;
        });

    if (!connected.length) {
        throw new Error('Tidak ada audio node yang aktif.');
    }

    const errors = [];

    for (const node of connected) {
        const config = configs.find(n => n.id === node.id);
        if (!config) continue;

        try {
            const base = `${config.secure ? 'https' : 'http'}://${config.host}:${config.port}`;
            const url = new URL('/v4/loadtracks', base);
            url.searchParams.set('identifier', query);

            const response = await fetch(url, {
                headers: {
                    Authorization: config.authorization,
                    'User-Id': botId,
                    'Client-Name': 'ZOMA-APP-V2/2.0.0'
                },
                signal: AbortSignal.timeout(15000)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const raw = await response.json();
            const tracks = Array.isArray(raw.data)
                ? raw.data
                : raw.data ? [raw.data] : [];

            for (const track of tracks) {
                track.requester = requester;
            }

            logger.info('SEARCH NODE SUCCESS', {
                node: node.id,
                loadType: raw.loadType,
                trackCount: tracks.length
            });

            return {
                loadType: String(raw.loadType || '').toLowerCase(),
                tracks,
                exception: raw.exception || null
            };
        } catch (error) {
            errors.push(`${node.id}: ${error.message}`);
            logger.warn('SEARCH NODE FAILED', {
                node: node.id,
                error: error.message
            });
        }
    }

    throw new Error(`Semua node pencarian gagal: ${errors.join(' | ')}`);
}

const MAX_RESULTS = 5;

export const searchCommand = new SlashCommandBuilder()
    .setName('search')
    .setDescription('Cari lagu dan pilih untuk diputar')
    .addStringOption(option =>
        option
            .setName('lagu')
            .setDescription('Judul lagu atau nama artis')
            .setRequired(true)
            .setMaxLength(200)
    );

function formatDuration(milliseconds) {
    if (!milliseconds || milliseconds <= 0) return 'Live';

    const seconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remaining = seconds % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
    }

    return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

function getTrackSource(track) {
    return track.info?.sourceName
        || track.info?.source
        || 'Unknown';
}

function getTrackTitle(track) {
    return track.info?.title || 'Unknown title';
}

function getTrackAuthor(track) {
    return track.info?.author || 'Unknown artist';
}

function buildResultsEmbed(tracks, user) {
    const description = tracks.map((track, index) => {
        const info = track.info;

        return [
            `**${index + 1}. ${getTrackTitle(track)}**`,
            `Artis: ${getTrackAuthor(track)}`,
            `Durasi: ${formatDuration(info?.duration)}`,
            `Sumber: ${getTrackSource(track)}`
        ].join('\n');
    }).join('\n\n');

    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎵 ZOMA MUSIC SEARCH')
        .setDescription(description)
        .setFooter({
            text: `Diminta oleh ${user.username} • Pilih lagu di bawah`
        })
        .setTimestamp();
}

async function cleanupCreatedPlayer(session) {
    if (!session.createdPlayer) return;

    const player = session.player;

    try {
        if (
            player
            && !player.playing
            && !player.paused
            && player.queue.tracks.length === 0
        ) {
            await player.destroy('search-expired');
        }
    } catch (error) {
        logger.warn('SEARCH PLAYER CLEANUP FAILED', {
            error: error.message
        });
    }
}

export async function executeSearch(interaction) {
    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    let player = null;
    let createdPlayer = false;

    try {
        if (!interaction.guild) {
            return interaction.editReply({
                content: '❌ Perintah ini hanya bisa digunakan di server.'
            });
        }

        if (!audioManager.started || !audioManager.manager) {
            return interaction.editReply({
                content: '❌ Audio Core belum siap. Coba lagi sebentar.'
            });
        }

        const connectedNodes = audioManager.getConnectedNodes();

        if (!connectedNodes.length) {
            return interaction.editReply({
                content: '❌ Semua Audio Node sedang offline.'
            });
        }

        const member = await interaction.guild.members.fetch(
            interaction.user.id
        );

        const voiceChannel = member.voice.channel;

        if (!voiceChannel) {
            return interaction.editReply({
                content: '❌ Masuk voice channel terlebih dahulu.'
            });
        }

        const botMember = await interaction.guild.members.fetchMe();

        const permissions = voiceChannel.permissionsFor(botMember);

        if (!permissions?.has([
            'ViewChannel',
            'Connect',
            'Speak'
        ])) {
            return interaction.editReply({
                content: '❌ Bot tidak memiliki izin View Channel, Connect, dan Speak.'
            });
        }

        player = null;
        createdPlayer = false;

        const query = interaction.options.getString('lagu', true).trim();

        if (!query) {
            if (createdPlayer) await player.destroy('empty-search');
            return interaction.editReply({
                content: '❌ Masukkan judul lagu atau nama artis.'
            });
        }

        const searchQuery = /^https?:\/\//i.test(query)
            ? query
            : `ytsearch:${query}`;

        logger.info('SEARCH REQUEST', { searchQuery });

        const result = await searchConnectedNodes(searchQuery, interaction.client.user.id, interaction.user);

        logger.info('SEARCH RAW RESULT', {
            query,
            loadType: result.loadType,
            trackCount: result.tracks?.length ?? 0,
            exception: result.exception,
            firstTrack: result.tracks?.[0] ? {
                title: result.tracks[0].info?.title,
                sourceName: result.tracks[0].info?.sourceName,
                hasEncoded: Boolean(result.tracks[0].encoded),
                keys: Object.keys(result.tracks[0])
            } : null
        });

        if (result.exception) {
            throw new Error(
                result.exception.message || 'Audio search failed'
            );
        }

        const tracks = (result.tracks || [])
            .filter(track =>
                track
                && track.info
                && track.info.title
                && track.encoded
            )
            .slice(0, MAX_RESULTS);

        if (!tracks.length) {
            if (createdPlayer) {
                await player.destroy('search-no-results');
            }

            return interaction.editReply({
                content: `🔎 Tidak ditemukan lagu untuk: **${query}**`
            });
        }

        const sessionId = randomUUID();
        const customId = `zoma_search_${sessionId}`;

        const menu = new StringSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder('🎵 Pilih lagu yang ingin diputar')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
                tracks.map((track, index) => ({
                    label: `${index + 1}. ${getTrackTitle(track)}`.slice(0, 100),
                    description: `${getTrackAuthor(track)} • ${formatDuration(track.info.duration)}`.slice(0, 100),
                    value: String(index)
                }))
            );

        const row = new ActionRowBuilder().addComponents(menu);

        const session = {
            userId: interaction.user.id,
            guildId: interaction.guild.id,
            voiceChannelId: voiceChannel.id,
            player,
            tracks,
            createdPlayer,
            timeout: null
        };

        pendingSearches.set(sessionId, session);

        // Search session tidak memiliki timeout otomatis.
        // Sesi berakhir ketika lagu dipilih atau dibatalkan.
        session.timeout = null;

        await interaction.editReply({
            content: `Hasil pencarian untuk **${query}** — pilih satu lagu:`,
            embeds: [buildResultsEmbed(tracks, interaction.user)],
            components: [row]
        });

    } catch (error) {
        logger.error('SEARCH COMMAND FAILED', {
            guildId: interaction.guildId,
            error: error.message
        });

        if (createdPlayer && player) {
            try {
                await player.destroy('search-error');
            } catch {
                // Cleanup best effort.
            }
        }

        await interaction.editReply({
            content: '❌ Pencarian gagal. Periksa koneksi Audio Node atau coba lagi.'
        }).catch(() => {});
    }
}

export async function handleSearchSelection(interaction) {
    const match = interaction.customId.match(/^zoma_search_([a-f0-9-]+)$/i);

    if (!match) return;

    const sessionId = match[1];
    const session = pendingSearches.get(sessionId);

    if (!session) {
        return interaction.reply({
            content: '❌ Sesi pencarian tidak ditemukan. Jalankan `/search` kembali.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (interaction.user.id !== session.userId) {
        return interaction.reply({
            content: '❌ Hanya orang yang melakukan pencarian yang bisa memilih lagu ini.',
            flags: MessageFlags.Ephemeral
        });
    }

    const selectedIndex = Number(interaction.values[0]);
    const track = session.tracks[selectedIndex];

    if (!track) {
        return interaction.reply({
            content: '❌ Pilihan lagu tidak valid.',
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferUpdate();

    clearTimeout(session.timeout);
    pendingSearches.delete(sessionId);

    try {
        const member = await interaction.guild.members.fetch(
            interaction.user.id
        );

        if (member.voice.channelId !== session.voiceChannelId) {
            throw new Error('Kamu sudah berpindah voice channel');
        }

        // Lepaskan player Lavalink sebelum mengambil alih voice lokal.
        const player = null;

        await interaction.editReply({
            content: [
                '𓆩 ⛧ ZOMA AUDIO SYSTEM ⛧ 𓆪',
                '',
                '🗣️ **SABAR ASU, LAGI DIPROSES!**',
                'Jangan spam tombol, tunggu bentar.',
                '',
                `🎵 **${getTrackTitle(track)}**`,
                '⚙️ Status: SEDANG DIPERSIAPKAN',
                '🎧 Audio Engine: WORKING'
            ].join('\n'),
            embeds: [],
            components: []
        });

        await localAudio.enqueue({
            guild: interaction.guild,
            voiceChannelId: session.voiceChannelId,
            track,
            onProgress: percent => {
                void interaction.editReply({
                    content: [
                        '𓆩 ⛧ ZOMA AUDIO SYSTEM ⛧ 𓆪',
                        '',
                        '🗣️ **SABAR ASU, LAGI DIPROSES!**',
                        'Jangan spam tombol, tunggu bentar.',
                        '',
                        `🎵 **${getTrackTitle(track)}**`,
                        `⚙️ Status: SEDANG DIPERSIAPKAN (${percent}%)`,
                        '🎧 Audio Engine: WORKING',
                        '',
                        '_Tenang, ZOMA lagi masak lagu lu._'
                    ].join('\n')
                }).catch(() => {});
            }
        });

        await interaction.editReply({
            content: [
                '🔥 **BERES ASU! LAGU SIAP DIPUTAR!**',
                '',
                `🎵 **${getTrackTitle(track)}**`,
                `🎤 Artis: ${getTrackAuthor(track)}`,
                `⏱️ Durasi: ${formatDuration(track.info.duration)}`,
                `📡 Sumber: ${getTrackSource(track)}`,
                `👤 Requester: ${interaction.user}`,
                '',
                '💿 LOCAL PLAYBACK ACTIVE • ZOMA APP V2'
            ].join('\n'),
            embeds: [],
            components: []
        });

        logger.info('SEARCH TRACK QUEUED', {
            guildId: session.guildId,
            title: getTrackTitle(track),
            requester: interaction.user.id
        });

    } catch (error) {
        logger.error('SEARCH SELECTION FAILED', {
            guildId: session.guildId,
            error: error.message
        });

        await interaction.editReply({
            content: `❌ Gagal memutar lagu: ${error.message}`,
            embeds: [],
            components: []
        }).catch(() => {});

        await cleanupCreatedPlayer(session);
    }
}
