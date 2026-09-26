import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const discordConfig = {
  token: () => required('DISCORD_TOKEN'),
  clientId: () => required('DISCORD_CLIENT_ID'),
  guildId: process.env.DISCORD_GUILD_ID || undefined,
};

export const deepseekConfig = {
  apiKey: () => required('DEEPSEEK_API_KEY'),
  model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
};
