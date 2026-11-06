import {
    executeSearch,
    handleSearchSelection
} from '../commands/search.js';

import { logger } from '../utils/logger.js';

export async function handleInteraction(interaction) {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'search') {
                await executeSearch(interaction);
            }

            return;
        }

        if (
            interaction.isStringSelectMenu()
            && interaction.customId.startsWith('zoma_search_')
        ) {
            await handleSearchSelection(interaction);
        }

    } catch (error) {
        logger.error('INTERACTION HANDLER FAILED', {
            error: error.message
        });

        const payload = {
            content: '❌ Terjadi kesalahan saat memproses interaksi.'
        };

        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                ...payload,
                flags: 64
            }).catch(() => {});
        } else {
            await interaction.reply({
                ...payload,
                flags: 64
            }).catch(() => {});
        }
    }
}
