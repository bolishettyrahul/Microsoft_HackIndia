import { describe, expect, it } from "vitest";
import { ApiError, createHttpApi } from "../api/http";
import { createMockApi } from "../api/mock";
import { laneFor, secondsUntil } from "../lib/lanes";

function recorder(status = 200, body: unknown = {}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : undefined });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, f };
}

describe("http client", () => {
  it("maps calls to the contract's endpoints", async () => {
    const { calls, f } = recorder();
    const api = createHttpApi("/api", f);
    await api.send("s1", "hi");
    await api.useModel("s1", "groq:openai/gpt-oss-120b");
    await api.burst("groq:openai/gpt-oss-120b");
    await api.updateSession("s1", { memory_on: false });
    await api.reverse("s1", { item_id: "i1", reason: null });
    await api.why("s1", { item_id: "i1" });
    await api.learning("my project");
    expect(calls).toEqual([
      { url: "/api/sessions/s1/turns", method: "POST", body: { text: "hi" } },
      { url: "/api/sessions/s1/models/use", method: "POST", body: { model_id: "groq:openai/gpt-oss-120b" } },
      { url: "/api/models/burst", method: "POST", body: { model_id: "groq:openai/gpt-oss-120b" } },
      { url: "/api/sessions/s1", method: "PATCH", body: { memory_on: false } },
      { url: "/api/sessions/s1/ledger/reverse", method: "POST", body: { item_id: "i1", reason: null } },
      { url: "/api/sessions/s1/ledger/why", method: "POST", body: { item_id: "i1" } },
      { url: "/api/projects/my%20project/learning", method: "GET", body: undefined },
    ]);
  });

  it("throws ApiError with the backend's detail", async () => {
    const { f } = recorder(404, { detail: "unknown session" });
    await expect(createHttpApi("/api", f).session("nope")).rejects.toEqual(new ApiError(404, "unknown session"));
  });
});

describe("mock backend plays the demo", () => {
  it("memory OFF restarts after a 429; re-run with memory ON continues", async () => {
    const api = createMockApi({ latencyMs: 0, extractionDelayMs: 0 });
    const s = await api.startSession({ project: "demo", user: "Rahul" });
    await api.send(s.session_id, "Plan caching for our FastAPI recall endpoint.");
    await api.send(s.session_id, "No Redis, we're on a free tier. And no bullet lists.");
    await new Promise((r) => setTimeout(r, 5));
    const ledger = await api.ledger(s.session_id);
    expect(ledger.map((r) => r.approach)).toEqual(["Redis"]);
    expect((await api.why(s.session_id, { item_id: ledger[0].item_id })).answer).toContain("free tier");
    expect((await api.learning("demo")).points.length).toBeGreaterThan(0);

    await api.burst("groq:openai/gpt-oss-120b");
    await api.updateSession(s.session_id, { memory_on: false });
    const off = await api.send(s.session_id, "Let's continue. What's the next step?");
    expect(off.handoffs[0]?.reason).toBe("429");
    expect(off.reply?.chips.filter((c) => !c.passed).map((c) => c.check_id)).toEqual(
      expect.arrayContaining(["continuity", "rejected"]),
    );

    const on = await api.rerun(s.session_id);
    expect(on.reply?.memory_on).toBe(true);
    expect(on.reply?.chips.every((c) => c.passed)).toBe(true);
    expect(on.earlier_attempts.at(-1)?.memory_on).toBe(false);
  });
});

describe("lanes", () => {
  const chain = [{ model_id: "a", label: "A" }, { model_id: "b", label: "B" }];
  it("colours by chain position, by id or label", () => {
    expect(laneFor("a", chain).name).toBe("a");
    expect(laneFor("B", chain).name).toBe("b");
    expect(laneFor("zzz", chain).name).toBe("x");
  });
  it("counts down whole seconds", () => {
    expect(secondsUntil(new Date(10_500).toISOString(), 0)).toBe(11);
    expect(secondsUntil(null)).toBe(0);
  });
});
