import { PermissionFlagsBits, type Guild, type GuildTextBasedChannel } from 'discord.js';

export interface ChannelSettings {
  /** Public channels an admin removed from analysis. */
  excluded: string[];
  /** Non-public channels an admin explicitly allowed. */
  included: string[];
}

export interface ChannelInfo {
  id: string;
  name: string;
  /** Visible to @everyone. */
  isPublic: boolean;
  /** The bot can view it and read its history. */
  botCanRead: boolean;
}

/**
 * A channel is analyzed when the bot can read it and it is either public and
 * not excluded, or explicitly included by an admin.
 */
export function resolveEligible(channels: ChannelInfo[], settings: ChannelSettings): ChannelInfo[] {
  const excluded = new Set(settings.excluded);
  const included = new Set(settings.included);
  return channels.filter(
    (c) => c.botCanRead && ((c.isPublic && !excluded.has(c.id)) || included.has(c.id)),
  );
}

/** Text channels in the guild (no threads), with their visibility. */
export function describeChannels(guild: Guild): Array<ChannelInfo & { channel: GuildTextBasedChannel }> {
  const me = guild.members.me;
  const everyone = guild.roles.everyone;
  return [...guild.channels.cache.values()]
    .filter((c): c is GuildTextBasedChannel => c.isTextBased() && !c.isThread())
    .map((channel) => ({
      channel,
      id: channel.id,
      name: channel.name,
      isPublic: channel.permissionsFor(everyone).has(PermissionFlagsBits.ViewChannel),
      botCanRead:
        !!me &&
        channel
          .permissionsFor(me)
          .has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]),
    }));
}

/** The channels whose messages may be analyzed in this guild. */
export function eligibleChannels(guild: Guild, settings: ChannelSettings): GuildTextBasedChannel[] {
  const described = describeChannels(guild);
  const ids = new Set(resolveEligible(described, settings).map((c) => c.id));
  return described.filter((c) => ids.has(c.id)).map((c) => c.channel);
}

/** Why a channel can't be used for analysis, or null if it can. */
export function ineligibleReason(
  info: Pick<ChannelInfo, 'id' | 'name' | 'isPublic' | 'botCanRead'> | undefined,
  settings: ChannelSettings,
): string | null {
  if (!info) return "That isn't a text channel I can analyze.";
  if (!info.botCanRead) return `I can't read the message history in #${info.name}.`;
  if (settings.excluded.includes(info.id)) return `An admin excluded #${info.name} from personality analysis.`;
  if (!info.isPublic && !settings.included.includes(info.id)) {
    return `#${info.name} isn't visible to everyone, so it isn't analyzed. An admin can add it with \`/personality channels include\`.`;
  }
  return null;
}
