import { complete } from '../llm.js';

const SYSTEM_PROMPT = `You summarize Discord conversations for someone catching up.
Write a concise summary using short bullet points grouped by topic.
Cover: main topics discussed, decisions or conclusions reached, open questions,
and notable contributions (attribute them to people by name).
Participants are pseudonymized as User1, User2, etc. Refer to them exactly by
those labels, and do not guess at their real identities.
Do not invent details that are not in the transcript. Keep it under 300 words
unless the conversation genuinely needs more. Use Discord markdown.`;

export async function summarize(transcript: string, channelName: string): Promise<string> {
  return complete(
    SYSTEM_PROMPT,
    `Transcript of #${channelName} (timestamps in UTC):\n\n${transcript}`,
  );
}
