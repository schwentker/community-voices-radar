import { BASE_SIGNAL_CLASSES, type SignalClass } from "../config/schema.js";
import type { Decider, DeciderContext, SignalInput, Verdict } from "./types.js";

// Local rule-based engine. Free, instant, offline. It is both the default
// engine and the fallback when a paid engine hits a cap or fails.

const OUTAGE = /\b(outage|is down|went down|are down|breach|vulnerab|data leak|stopped (working|delivering|sending)|not loading|500 error|502|503)\b/i;
const CHURN = /\b(leaving|cancel(l?ing)?|moving (off|away)|migrat(e|ing) (off|away)|switch(ing)? (off|away|from)|quit(ting)?|done with|fed up)\b/i;
const SWITCH_WORDS = /\b(switch(ing)? to|moving to|migrat(e|ing) to|compared to|vs\.?|versus|alternative to)\b/i;
const PRAISE = /\b(love|loving|great|awesome|amazing|thank(s| you)|works (great|well)|impressed|game.?changer)\b/i;
const FEATURE = /\b(feature request|would love|wish (there|it)|please add|feature idea|it would be nice)\b/i;
const PAIN = /\b(broken|not working|error|bug|frustrat\w*|issue with|can'?t|cannot|fail(s|ed|ing)?|stuck|slow|expensive)\b/i;

const URGENCY = /\b(urgent|asap|right now|immediately|blocked|blocking|deadline|production|prod\b|down|outage|stopped|failing|lost (sales|orders|revenue))\b/i;
const BUSINESS = /\b(revenue|sales|orders|customers|churn|fees|pricing|price|cost|contract|enterprise|plus|migrat\w*|leaving|cancel\w*|switch\w*)\b/i;

interface Candidate {
  cls: SignalClass;
  strength: number;
  reason: string;
}

function candidates(input: SignalInput): Candidate[] {
  const text = input.text;
  const found: Candidate[] = [];

  if (OUTAGE.test(text)) found.push({ cls: "security_outage", strength: 0.85, reason: "outage or security wording" });
  if (CHURN.test(text)) found.push({ cls: "churn_risk", strength: 0.8, reason: "says they are leaving or cancelling" });
  if (input.otherCompanies.length > 0 && SWITCH_WORDS.test(text)) {
    found.push({ cls: "competitor_switch", strength: 0.75, reason: `compares or switches with ${input.otherCompanies.join(", ")}` });
  }
  if (PRAISE.test(text)) found.push({ cls: "praise", strength: 0.7, reason: "praise wording" });
  if (FEATURE.test(text)) found.push({ cls: "feature_request", strength: 0.8, reason: "asks for a feature" });

  const painWords = input.painKeywords.filter((word) => word && text.toLowerCase().includes(word.toLowerCase()));
  if (painWords.length > 0) found.push({ cls: "pain_point", strength: 0.7, reason: `pain keywords: ${painWords.slice(0, 3).join(", ")}` });
  else if (PAIN.test(text)) found.push({ cls: "pain_point", strength: 0.6, reason: "generic pain wording" });

  if (text.includes("?")) found.push({ cls: "question", strength: 0.65, reason: "contains a question" });
  return found;
}

export function scoreWithRules(input: SignalInput, context: Pick<DeciderContext, "weights" | "allowedClasses">): Verdict {
  const allowed = new Set<SignalClass>([...BASE_SIGNAL_CLASSES, ...context.allowedClasses]);
  const options = candidates(input)
    .filter((candidate) => allowed.has(candidate.cls))
    .sort((a, b) => b.strength - a.strength);

  const best = options[0];
  const second = options[1];
  const signalClass: SignalClass = best?.cls ?? "discussion";

  // Confidence: strength of the best match, reduced when a different class is close behind.
  let confidence = best ? best.strength : 0.45;
  if (best && second && best.cls !== second.cls && best.strength - second.strength < 0.12) {
    confidence = Math.max(0.35, confidence - 0.25);
  }

  const urgency = URGENCY.test(input.text) ? 1 : signalClass === "security_outage" ? 1 : 0.15;
  const reach = Math.min(1, Math.log10(1 + Math.max(0, input.rank)) / 2);
  const business = BUSINESS.test(input.text) || signalClass === "churn_risk" ? 1 : 0.15;

  const { urgency: wu, reach: wr, business: wb } = context.weights;
  const total = wu + wr + wb;
  const importance = total > 0 ? (urgency * wu + reach * wr + business * wb) / total : 0;

  return {
    signalClass,
    importance: Number(importance.toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    reasons: best ? [best.reason] : ["no strong pattern"],
  };
}

export class RulesDecider implements Decider {
  readonly name = "rules";

  async decide(input: SignalInput, context: DeciderContext): Promise<Verdict> {
    return scoreWithRules(input, context);
  }
}
