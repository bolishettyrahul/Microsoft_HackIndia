// The four extra reply checks (planv3 B7), as the in-browser fake runs them. The real ones live in
// baton/backend/verifier.py; these follow the same rules so the demo chips look the same.
import type { ChipView, PatchStat, Preferences } from "../api/contract";

const PREAMBLE = /^\s*(great question|sure|certainly|absolutely|of course)\b/i;
const EMOJI = /\p{Extended_Pictographic}/gu;

/** Text outside ``` fences, and the language tag of every fence. */
function split(text: string): { prose: string; tags: string[] } {
  const parts = text.split("```");
  const prose = parts.filter((_, i) => i % 2 === 0).join("\n");
  const tags = parts.filter((_, i) => i % 2 === 1).map((p) => p.split("\n", 1)[0].trim().toLowerCase());
  return { prose, tags };
}

export function extraChips(text: string, prefs: Preferences): ChipView[] {
  const { prose, tags } = split(text);
  const out: ChipView[] = [];
  if (prefs.max_words) {
    const n = prose.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length; // a word has a letter or digit
    out.push({ check_id: "max_words", passed: n <= prefs.max_words, label: `max ${prefs.max_words} words`, evidence: `${n} / ${prefs.max_words} words` });
  }
  if (prefs.no_emojis) {
    const found = [...new Set(prose.match(EMOJI) ?? [])];
    out.push({ check_id: "no_emojis", passed: found.length === 0, label: "no-emojis", evidence: found.length ? found.join(" ") : "No emojis" });
  }
  if (prefs.no_preamble) {
    const first = prose.trim().split(/(?<=[.!?])\s/, 1)[0] ?? "";
    const hit = first.match(PREAMBLE);
    out.push({ check_id: "no_preamble", passed: !hit, label: "no-preamble", evidence: hit ? `“${first.slice(0, 60)}”` : "Opens with the answer" });
  }
  if (prefs.code_languages) {
    const allowed = prefs.code_languages.map((l) => l.toLowerCase());
    const bad = tags.filter((t) => !t || !allowed.includes(t));
    out.push({
      check_id: "code_language", passed: bad.length === 0, label: `code: ${allowed.join(", ")}`,
      evidence: tags.length === 0 ? "No code blocks" : bad.length ? `Fence tagged ${bad.map((t) => t || "(none)").join(", ")}` : `${tags.length} fence(s) OK`,
    });
  }
  return out;
}

// ---------------------------------------------------------------- patch levels (spec §10.3, planv3 B8)

export const LEVELS = [0, 1, 2, 3] as const;
export type LevelVerdict = "good" | "bad" | "untested";

export function verdict(s: PatchStat | undefined): LevelVerdict {
  if (!s || s.trials < 3) return "untested";
  return s.passes / s.trials >= 0.8 ? "good" : "bad";
}

/** The level the backend will use for a (model, check): the first proven good or untested; 3 if all are bad. */
export function chosenLevel(stats: PatchStat[], model: string, check: string): number {
  for (const level of LEVELS) {
    const v = verdict(stats.find((s) => s.model === model && s.check_id === check && s.level === level));
    if (v !== "bad") return level;
  }
  return 3;
}
