import { describe, expect, it } from "vitest";
import type { PatchStat, Preferences } from "../api/contract";
import { createHttpApi } from "../api/http";
import { createMockApi } from "../api/mock";
import { demoProgress } from "../app/demoSteps";
import { chosenLevel, extraChips } from "../lib/checks";

function recorder() {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : undefined });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return { calls, f };
}

const prefs = (p: Partial<Preferences>): Preferences => ({ no_bullets: false, free_text: [], ...p });
const byId = (chips: ReturnType<typeof extraChips>) => Object.fromEntries(chips.map((c) => [c.check_id, c]));

describe("v3 http client", () => {
  it("maps learning, why and the new prefs", async () => {
    const { calls, f } = recorder();
    const api = createHttpApi("/api", f);
    await api.learning("demo");
    await api.why("s1", "i9");
    await api.updateSession("s1", { prefs: prefs({ max_words: 120, no_emojis: true, code_languages: ["python"] }) });
    expect(calls).toEqual([
      { url: "/api/projects/demo/learning", method: "GET", body: undefined },
      { url: "/api/sessions/s1/ledger/why", method: "POST", body: { item_id: "i9" } },
      {
        url: "/api/sessions/s1", method: "PATCH",
        body: { prefs: { no_bullets: false, free_text: [], max_words: 120, no_emojis: true, code_languages: ["python"] } },
      },
    ]);
  });
});

describe("extra checks", () => {
  const all = prefs({ max_words: 5, no_emojis: true, no_preamble: true, code_languages: ["python"] });
  it("passes a clean reply and ignores what's inside code fences", () => {
    const c = byId(extraChips("Wrap recall in a cache.\n```python\nsure = 1  # 🚀 lots of words in here\n```", all));
    expect(Object.values(c).every((x) => x.passed)).toBe(true);
    expect(c.max_words.evidence).toBe("5 / 5 words");
  });
  it("fails each check with evidence", () => {
    const c = byId(extraChips("Sure! Here is a much longer answer 🚀 than allowed.\n```\nx\n```", all));
    expect(c.max_words).toMatchObject({ passed: false, evidence: "9 / 5 words" });
    expect(c.no_emojis).toMatchObject({ passed: false, evidence: "🚀" });
    expect(c.no_preamble.passed).toBe(false);
    expect(c.code_language).toMatchObject({ passed: false, evidence: "Fence tagged (none)" });
  });
  it("adds no chips when the checks are off", () => {
    expect(extraChips("Sure 🚀", prefs({}))).toEqual([]);
  });
});

describe("patch level choice", () => {
  const s = (level: number, passes: number, trials: number): PatchStat => ({ model: "m", check_id: "rejected", level, passes, trials });
  it("takes the first proven-good or untested level, skipping proven-bad ones", () => {
    expect(chosenLevel([], "m", "rejected")).toBe(0);
    expect(chosenLevel([s(0, 4, 5)], "m", "rejected")).toBe(0);
    expect(chosenLevel([s(0, 1, 5), s(1, 1, 2)], "m", "rejected")).toBe(1);
    expect(chosenLevel([s(0, 1, 5), s(1, 0, 3), s(2, 1, 4), s(3, 0, 3)], "m", "rejected")).toBe(3);
  });
});

describe("demo rail", () => {
  it("steps Plan -> Hit 429 -> Memory OFF -> Re-run ON -> Copy baton from real state", async () => {
    const api = createMockApi({ latencyMs: 0, extractionDelayMs: 0 });
    const s = await api.startSession({ project: "demo", user: "Rahul" });
    const sid = s.session_id;
    const step = async (copied = false) => demoProgress({
      turns: await api.turns(sid), models: await api.models(sid), ledgerCount: (await api.ledger(sid)).length, copied,
    }).current;

    expect(await step()).toBe("plan");
    await api.send(sid, "Plan caching for our FastAPI recall endpoint.");
    await api.send(sid, "No Redis, we're on a free tier.");
    await new Promise((r) => setTimeout(r, 5));
    expect(await step()).toBe("limit");
    await api.burst("groq:openai/gpt-oss-120b");
    expect(await step()).toBe("off");
    await api.updateSession(sid, { memory_on: false });
    await api.send(sid, "Let's continue. What's the next step?");
    expect(await step()).toBe("rerun");
    await api.rerun(sid);
    expect(await step()).toBe("copy");
    expect(await step(true)).toBeNull();
  });
});

describe("mock learning and why", () => {
  it("has history per model, and answers why with sources", async () => {
    const api = createMockApi({ latencyMs: 0, extractionDelayMs: 0 });
    const s = await api.startSession({ project: "demo", user: "Rahul" });
    await api.send(s.session_id, "Plan caching.");
    await api.send(s.session_id, "No Redis, we're on a free tier.");
    await new Promise((r) => setTimeout(r, 5));
    const l = await api.learning("demo");
    expect(new Set(l.points.map((p) => p.model)).size).toBe(3);
    expect(l.stats.length).toBeGreaterThan(0);
    const [row] = await api.ledger(s.session_id);
    const w = await api.why(s.session_id, row.item_id);
    expect(w).toMatchObject({ approach: "Redis", error: null });
    expect(w.answer).toContain("free tier");
    expect(w.sources[0]).toContain("Rahul");
  });
});
