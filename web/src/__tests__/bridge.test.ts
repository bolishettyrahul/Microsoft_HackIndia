import { describe, expect, it } from "vitest";
import {
  CONNECTED_MS, ago, appOfLine, isConnected, relayMove, repairedChecks, sortEvents, type AppStatus, type BridgeEvent,
} from "../api/bridge";
import { createHttpApi } from "../api/http";
import { createMockApi } from "../api/mock";

function recorder(body: unknown = {}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : undefined });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { calls, f };
}

const ev = (at: number, app: BridgeEvent["app"], action: BridgeEvent["action"], passed: boolean | null = null): BridgeEvent => ({
  at: new Date(at).toISOString(), project: "demo", app, action, summary: `${app} ${action} ${at}`, items: 0, passed,
});

describe("bridge http client", () => {
  it("maps the three bridge calls to their endpoints", async () => {
    const { calls, f } = recorder();
    const api = createHttpApi("/api", f);
    await api.bridge("my demo");
    await api.bridgeSetup();
    await api.importExchange("demo", { app: "chatgpt", user_message: "No Redis.", assistant_reply: "Understood." });
    expect(calls).toEqual([
      { url: "/api/projects/my%20demo/bridge", method: "GET", body: undefined },
      { url: "/api/bridge/setup", method: "GET", body: undefined },
      {
        url: "/api/projects/demo/import", method: "POST",
        body: { app: "chatgpt", user_message: "No Redis.", assistant_reply: "Understood." },
      },
    ]);
  });
});

describe("lane status", () => {
  const status = (last_seen: string | null): AppStatus => ({ app: "claude", connected: true, last_seen, pulls: 0, records: 0, checks: 0 });
  it("is connected only when seen in the last 10 minutes", () => {
    const now = 1_000_000_000;
    expect(isConnected(status(new Date(now - 5_000).toISOString()), now)).toBe(true);
    expect(isConnected(status(new Date(now - CONNECTED_MS - 1).toISOString()), now)).toBe(false);
    expect(isConnected(status(null), now)).toBe(false);
    expect(isConnected(undefined, now)).toBe(false);
  });
  it("says how long ago", () => {
    expect(ago(new Date(0).toISOString(), 12_000)).toBe("12 s ago");
    expect(ago(new Date(0).toISOString(), 240_000)).toBe("4 min ago");
    expect(ago(null)).toBe("never");
  });
  it("tags lines by the app that recorded them", () => {
    expect(appOfLine({ user: "ChatGPT" })).toBe("chatgpt");
    expect(appOfLine({ user: "Claude" })).toBe("claude");
    expect(appOfLine({ user: "Rahul" })).toBe("baton");
  });
});

describe("timeline", () => {
  it("orders newest first, stable on ties", () => {
    const a = ev(1000, "chatgpt", "record");
    const b = ev(3000, "claude", "pull");
    const c = { ...ev(3000, "claude", "check", true), summary: "tie" };
    expect(sortEvents([a, b, c])).toEqual([b, c, a]);
  });
  it("marks a passing check after a failed one as the repair", () => {
    const fail = ev(1000, "claude", "check", false);
    const pass = ev(2000, "claude", "check", true);
    const later = ev(3000, "claude", "check", true);
    const keys = repairedChecks([later, pass, fail]);
    expect(keys.size).toBe(1);
    expect([...keys][0]).toContain(pass.summary);
  });
  it("moves the baton from the recorder to the puller", () => {
    const rec = ev(1000, "chatgpt", "record");
    const pull = ev(2000, "claude", "pull");
    expect(relayMove(rec, [rec])).toEqual({ from: "chatgpt", to: "baton" });
    expect(relayMove(pull, [pull, rec])).toEqual({ from: "chatgpt", to: "claude" });
    expect(relayMove(ev(3000, "claude", "check", true), [])).toBeNull();
  });
});

describe("mock bridge", () => {
  it("plays the story: ChatGPT records, Claude pulls, fails a check, then passes", async () => {
    const api = createMockApi({ latencyMs: 0, bridgeStepMs: 0 });
    const v = await api.bridge("demo");
    expect(sortEvents(v.events).reverse().map((e) => `${e.app}:${e.action}${e.passed === null ? "" : e.passed ? "+" : "-"}`)).toEqual([
      "chatgpt:record", "chatgpt:record", "claude:pull", "claude:check-", "claude:check+", "claude:record",
    ]);
    expect(v.contract.rejections.map((r) => [r.text, r.user])).toEqual([["Redis", "ChatGPT"]]);
    expect(v.contract.next_step?.user).toBe("Claude");
    expect(v.apps.map((a) => [a.app, a.pulls, a.records, a.checks])).toEqual([["chatgpt", 0, 2, 0], ["claude", 1, 1, 2]]);
  });
  it("imports a pasted exchange into an empty project", async () => {
    const api = createMockApi({ latencyMs: 0, bridgeStepMs: 0 });
    expect((await api.bridge("other")).events).toEqual([]);
    const v = await api.importExchange("other", {
      app: "chatgpt", user_message: "No Redis, we're on a free tier. Let's use an in-process cache.",
      assistant_reply: "Understood. Next, wrap recall() in a TTLCache.",
    });
    expect(v.events[0]).toMatchObject({ app: "chatgpt", action: "import", items: 3 });
    expect(v.ledger[0]).toMatchObject({ approach: "Redis", reason: "a free tier", user: "ChatGPT" });
  });
});
