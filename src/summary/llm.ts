import OpenAI from 'openai';
import { deepseekConfig } from '../config.js';

const SYSTEM_PROMPT = `You summarize Discord conversations for someone catching up.
Write a concise summary using short bullet points grouped by topic.
Cover: main topics discussed, decisions or conclusions reached, open questions,
and notable contributions (attribute them to people by name).
Participants are pseudonymized as User1, User2, etc. Refer to them exactly by
those labels, and do not guess at their real identities.
Do not invent details that are not in the transcript. Keep it under 300 words
unless the conversation genuinely needs more. Use Discord markdown.`;

let client: OpenAI | undefined;

function getClient(): OpenAI {
  client ??= new OpenAI({
    apiKey: deepseekConfig.apiKey(),
    baseURL: deepseekConfig.baseURL,
  });
  return client;
}

export async function summarize(transcript: string, channelName: string): Promise<string> {
  const response = await getClient().chat.completions.create({
    model: deepseekConfig.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Transcript of #${channelName} (timestamps in UTC):\n\n${transcript}`,
      },
    ],
    temperature: 0.3,
  });

  const summary = response.choices[0]?.message?.content?.trim();
  if (!summary) {
    throw new Error('The model returned an empty summary.');
  }
  return summary;
}
