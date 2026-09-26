import OpenAI from 'openai';
import { deepseekConfig } from './config.js';

let client: OpenAI | undefined;

function getClient(): OpenAI {
  client ??= new OpenAI({
    apiKey: deepseekConfig.apiKey(),
    baseURL: deepseekConfig.baseURL,
  });
  return client;
}

/** Sends one system + user message to the configured model and returns its reply. */
export async function complete(
  system: string,
  user: string,
  { temperature = 0.3 }: { temperature?: number } = {},
): Promise<string> {
  const response = await getClient().chat.completions.create({
    model: deepseekConfig.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
  });

  const text = response.choices[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('The model returned an empty response.');
  }
  return text;
}
