/**
 * Deterministic safety guard for the coach. Crisis and eating-disorder
 * messages get a fixed, supportive reply with resources instead of an LLM answer.
 */
const CRISIS_RE = /\b(suicid\w*|kill (myself|me)|self[- ]?harm|hurt myself|end my life)\b/i;
const ED_RE = /\b(purg(e|ing)|make myself (throw up|vomit|sick)|laxatives? to lose|starv(e|ing) myself|binge and purge)\b/i;

export const SAFETY_REPLIES = {
  crisis:
    "I'm really sorry you're going through this. You deserve support right now. If you might act on these thoughts or are in danger, please contact your local emergency number. In the US you can call or text 988 (Suicide & Crisis Lifeline); elsewhere, findahelpline.com lists free, confidential services. If you can, reach out to someone you trust. I'm here for nutrition questions whenever you want, but this matters more.",
  eatingDisorder:
    "Thank you for sharing that — it sounds really hard. Purging, starving or using laxatives to control weight can be harmful, and you deserve care from people trained to help. Please consider talking with a doctor, or an eating-disorder helpline (in the US, ANAD: 1-888-375-7767; in the UK, Beat: 0808 801 0677). If you'd like, Ascend can stop showing calorie targets — choose \"I'd prefer not to see calorie targets\" under Profile → Goals & targets.",
} as const;

export function safetyReplyFor(message: string): string | null {
  if (CRISIS_RE.test(message)) return SAFETY_REPLIES.crisis;
  if (ED_RE.test(message)) return SAFETY_REPLIES.eatingDisorder;
  return null;
}
