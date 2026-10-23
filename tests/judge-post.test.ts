import { describe, expect, it } from 'vitest';
import { postPublicly } from '../src/commands/judge.js';

function fakeInteraction(opts: { failDelete?: boolean } = {}) {
  const calls: Array<{ method: string; arg?: any }> = [];
  return {
    calls,
    interaction: {
      editReply: async (arg: any) => void calls.push({ method: 'editReply', arg }),
      followUp: async (arg: any) => void calls.push({ method: 'followUp', arg }),
      deleteReply: async () => {
        calls.push({ method: 'deleteReply' });
        if (opts.failDelete) throw new Error('Unknown Message');
      },
    } as any,
  };
}

describe('postPublicly', () => {
  it('uses up the private deferred reply before sending the public follow-up', async () => {
    const { interaction, calls } = fakeInteraction();
    await postPublicly(interaction, { content: 'verdict', embeds: [] });
    expect(calls.map((c) => c.method)).toEqual(['editReply', 'followUp', 'deleteReply']);
  });

  it('sends the follow-up publicly without pinging anyone', async () => {
    const { interaction, calls } = fakeInteraction();
    await postPublicly(interaction, { content: 'verdict' });
    const follow = calls.find((c) => c.method === 'followUp')!.arg;
    expect(follow.flags).toBeUndefined();
    expect(follow.allowedMentions).toEqual({ parse: [] });
    expect(follow.content).toBe('verdict');
  });

  it('does not throw if the placeholder is already gone', async () => {
    const { interaction } = fakeInteraction({ failDelete: true });
    await expect(postPublicly(interaction, { content: 'verdict' })).resolves.toBeUndefined();
  });
});
