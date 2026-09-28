// Names shorter than this are too likely to match ordinary words, so they are
// not scrubbed from plain text (mentions are still replaced).
const MIN_SCRUB_NAME_LENGTH = 3;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replaces Discord users with stable pseudonyms (User1, User2, ...) so real
 * names are never sent to the LLM, and maps them back afterwards.
 * Create one per request; the mapping lives only in memory.
 */
export class Pseudonymizer {
  private aliasById = new Map<string, string>();
  private realNameByAlias = new Map<string, string>();
  private aliasByName = new Map<string, string>(); // lowercased name -> alias
  private namePattern: RegExp | null | undefined;

  /**
   * Returns the alias for a user, creating one on first sight. `names` are all
   * the names the user might be referred to by; the first is the one restored
   * into the summary.
   */
  alias(userId: string, names: Array<string | null | undefined> = []): string {
    let alias = this.aliasById.get(userId);
    if (!alias) {
      alias = `User${this.aliasById.size + 1}`;
      this.aliasById.set(userId, alias);
    }

    for (const raw of names) {
      const name = raw?.trim();
      if (!name) continue;
      if (!this.realNameByAlias.has(alias)) this.realNameByAlias.set(alias, name);
      const key = name.toLowerCase();
      if (name.length >= MIN_SCRUB_NAME_LENGTH && !this.aliasByName.has(key)) {
        this.aliasByName.set(key, alias);
        this.namePattern = undefined;
      }
    }
    return alias;
  }

  /**
   * Replaces raw user mentions (`<@id>`, `<@!id>`) with `@UserN`, then
   * best-effort replaces plain-text occurrences of known names.
   */
  scrubText(text: string): string {
    const withMentions = text.replace(/<@!?(\d+)>/g, (_, id: string) => `@${this.alias(id)}`);

    const pattern = this.getNamePattern();
    if (!pattern) return withMentions;
    return withMentions.replace(
      pattern,
      (match) => this.aliasByName.get(match.toLowerCase()) ?? match,
    );
  }

  /** Swaps aliases in LLM output back to real names. Unknown aliases are left as-is. */
  restore(text: string): string {
    return text.replace(
      /\bUser\d+\b/g,
      (alias) => this.realNameByAlias.get(alias) ?? alias,
    );
  }

  private getNamePattern(): RegExp | null {
    if (this.namePattern === undefined) {
      const names = [...this.aliasByName.keys()].sort((a, b) => b.length - a.length);
      this.namePattern =
        names.length === 0
          ? null
          : new RegExp(
              // Underscore counts as a boundary so "alice_notes.txt" is caught;
              // longer names like "alice_w" still win because they sort first.
              `(?<![\\p{L}\\p{N}])(?:${names.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`,
              'giu',
            );
    }
    return this.namePattern;
  }
}
