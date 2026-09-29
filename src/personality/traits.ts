export interface Trait {
  id: string;
  name: string;
  /** Short label for the -1 end. */
  low: string;
  /** Short label for the +1 end. */
  high: string;
  /** One-line definition given to the model. */
  definition: string;
  family: 'Big Five' | 'HEXACO' | 'Moral Foundations' | 'Language style';
}

export const TRAITS: Trait[] = [
  // Big Five
  { id: 'openness', name: 'Openness', low: 'Conventional', high: 'Curious', family: 'Big Five',
    definition: 'Interest in new ideas, abstraction, nuance, and unfamiliar perspectives vs preference for the familiar and concrete.' },
  { id: 'conscientiousness', name: 'Conscientiousness', low: 'Spontaneous', high: 'Methodical', family: 'Big Five',
    definition: 'Careful, organized, precise, follows through vs loose, impulsive, disorganized.' },
  { id: 'extraversion', name: 'Extraversion', low: 'Reserved', high: 'Outgoing', family: 'Big Five',
    definition: 'Energetic, talkative, socially engaging, enthusiastic vs quiet, brief, low-key.' },
  { id: 'agreeableness', name: 'Agreeableness', low: 'Combative', high: 'Cooperative', family: 'Big Five',
    definition: 'Warm, conciliatory, generous in interpreting others vs blunt, adversarial, dismissive.' },
  { id: 'stability', name: 'Emotional stability', low: 'Reactive', high: 'Even-keeled', family: 'Big Five',
    definition: 'Calm and steady under disagreement vs easily frustrated, anxious, or upset (inverse of neuroticism).' },
  // HEXACO
  { id: 'honesty', name: 'Honesty-humility', low: 'Self-promoting', high: 'Modest', family: 'HEXACO',
    definition: 'Sincere, fair-minded, admits mistakes, modest vs boastful, status-seeking, point-scoring.' },
  // Moral Foundations
  { id: 'care', name: 'Care', low: 'Low', high: 'High', family: 'Moral Foundations',
    definition: 'How much arguments appeal to preventing harm and protecting the vulnerable.' },
  { id: 'fairness', name: 'Fairness', low: 'Low', high: 'High', family: 'Moral Foundations',
    definition: 'How much arguments appeal to equality, justice, rights, and reciprocity.' },
  { id: 'loyalty', name: 'Loyalty', low: 'Low', high: 'High', family: 'Moral Foundations',
    definition: 'How much arguments appeal to group, nation, or team solidarity and betrayal.' },
  { id: 'authority', name: 'Authority', low: 'Low', high: 'High', family: 'Moral Foundations',
    definition: 'How much arguments appeal to order, tradition, legitimate hierarchy, and respect.' },
  { id: 'sanctity', name: 'Sanctity', low: 'Low', high: 'High', family: 'Moral Foundations',
    definition: 'How much arguments appeal to purity, sacredness, and disgust at degradation.' },
  { id: 'liberty', name: 'Liberty', low: 'Low', high: 'High', family: 'Moral Foundations',
    definition: 'How much arguments appeal to freedom from coercion and resistance to domination.' },
  // Language style
  { id: 'analytical', name: 'Analytical', low: 'Narrative', high: 'Analytical', family: 'Language style',
    definition: 'Logical, structured, evidence and argument driven vs anecdotal, personal, story-driven.' },
  { id: 'certainty', name: 'Certainty', low: 'Tentative', high: 'Certain', family: 'Language style',
    definition: 'Confident, absolute claims vs hedged, qualified, open to being wrong.' },
  { id: 'tone', name: 'Emotional tone', low: 'Negative', high: 'Positive', family: 'Language style',
    definition: 'Overall emotional tone of the writing, from negative (angry, gloomy) to positive (upbeat, warm).' },
  { id: 'collective', name: 'Collective focus', low: 'Individual', high: 'Collective', family: 'Language style',
    definition: 'Framing in terms of "we", groups, and society vs "I", personal experience, and individuals.' },
];

export const TRAIT_IDS = TRAITS.map((t) => t.id);
const byId = new Map(TRAITS.map((t) => [t.id, t]));

export function getTrait(id: string): Trait | undefined {
  return byId.get(id);
}

/** Shown until a server runs /personality calibrate. */
export const DEFAULT_DIMENSIONS = [
  'openness',
  'conscientiousness',
  'extraversion',
  'agreeableness',
  'stability',
  'analytical',
  'certainty',
];

export const MAX_DIMENSIONS = 8;

export type Scores = Record<string, number>;
