import {
  ChannelType,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { postDailyNews, resolveNewsChannel } from '../news/post.js';
import { deleteConfig, getConfig, setConfig } from '../news/store.js';
import { formatTime12h, localDateTime, NEWS_TIMEZONE, parseTime } from '../news/time.js';

const DEFAULT_TIME = '08:00';
const NOW_COOLDOWN_MS = 5 * 60_000;
const lastManualPost = new Map<string, number>();

export const data = new SlashCommandBuilder()
  .setName('dailynews')
  .setDescription('Post the day\'s top 3 news stories to a channel')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('setup')
      .setDescription('Choose the channel and time for the daily news post')
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Channel to post in')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName('time')
          .setDescription(`24-hour time in US Eastern, e.g. 08:00 or 17:30 (default ${DEFAULT_TIME})`),
      ),
  )
  .addSubcommand((sub) => sub.setName('now').setDescription('Post today\'s top stories right now'))
  .addSubcommand((sub) => sub.setName('status').setDescription('Show the current daily news setup'))
  .addSubcommand((sub) => sub.setName('stop').setDescription('Stop the daily news post'));

function ephemeral(content: string) {
  return { content, flags: MessageFlags.Ephemeral } as const;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply(ephemeral('This command only works in a server.'));
    return;
  }
  const guildId = interaction.guildId;

  switch (interaction.options.getSubcommand()) {
    case 'setup': {
      const channel = interaction.options.getChannel('channel', true);
      const timeInput = interaction.options.getString('time') ?? DEFAULT_TIME;
      const time = parseTime(timeInput);
      if (!time) {
        await interaction.reply(
          ephemeral(`"${timeInput}" isn't a valid time. Use 24-hour HH:MM, like 08:00 or 17:30.`),
        );
        return;
      }

      const resolved = await resolveNewsChannel(interaction.client, channel.id);
      if ('error' in resolved) {
        await interaction.reply(ephemeral(resolved.error));
        return;
      }

      // If today's time has already passed, start tomorrow instead of posting immediately.
      const local = localDateTime(new Date());
      const previous = getConfig(guildId);
      setConfig(guildId, {
        ...previous,
        channelId: channel.id,
        time,
        lastPostedDate:
          local.time >= time || previous?.lastPostedDate === local.date ? local.date : undefined,
      });

      await interaction.reply(
        ephemeral(
          `Daily news will be posted in <#${channel.id}> at ${formatTime12h(time)} US Eastern. ` +
            'Use `/dailynews now` to post one right away.',
        ),
      );
      return;
    }

    case 'now': {
      const config = getConfig(guildId);
      if (!config) {
        await interaction.reply(ephemeral('Run `/dailynews setup` first to choose a channel.'));
        return;
      }
      const last = lastManualPost.get(guildId);
      if (last && Date.now() - last < NOW_COOLDOWN_MS) {
        await interaction.reply(ephemeral('A news post was just made. Try again in a few minutes.'));
        return;
      }

      const resolved = await resolveNewsChannel(interaction.client, config.channelId);
      if ('error' in resolved) {
        await interaction.reply(ephemeral(resolved.error));
        return;
      }

      lastManualPost.set(guildId, Date.now());
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        await postDailyNews(guildId, resolved.channel);
        await interaction.editReply(`Posted today's top stories in <#${config.channelId}>.`);
      } catch (err) {
        console.error('dailynews now failed:', err);
        lastManualPost.delete(guildId);
        await interaction.editReply('Sorry, something went wrong fetching or posting the news.');
      }
      return;
    }

    case 'status': {
      const config = getConfig(guildId);
      await interaction.reply(
        ephemeral(
          config
            ? `Daily news posts in <#${config.channelId}> at ${formatTime12h(config.time)} ` +
                `(${NEWS_TIMEZONE}). Last scheduled post: ${config.lastPostedDate ?? 'none yet'}.`
            : 'Daily news is not set up. Use `/dailynews setup`.',
        ),
      );
      return;
    }

    case 'stop': {
      const removed = deleteConfig(guildId);
      await interaction.reply(
        ephemeral(removed ? 'Daily news stopped.' : 'Daily news was not set up.'),
      );
      return;
    }
  }
}
