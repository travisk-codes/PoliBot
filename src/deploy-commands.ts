import { REST, Routes } from 'discord.js';
import { commands } from './commands/index.js';
import { discordConfig } from './config.js';

const rest = new REST().setToken(discordConfig.token());
const body = commands.map((c) => c.data.toJSON());
const clientId = discordConfig.clientId();
const guildId = discordConfig.guildId;

const route = guildId
  ? Routes.applicationGuildCommands(clientId, guildId)
  : Routes.applicationCommands(clientId);

await rest.put(route, { body });
console.log(
  `Registered ${body.length} command(s) ${guildId ? `to guild ${guildId}` : 'globally'}.`,
);
