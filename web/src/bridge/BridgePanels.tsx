import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ClipboardPaste, Lock, X } from "lucide-react";
import type { BridgeEvent, BridgeSetup } from "../api/contract";
import { APP_NAME, type ExternalApp } from "../lib/bridge";
import { Button, cx } from "../components/ui";
import { CopyButton } from "../app/Chat";
import { AppIcon } from "./AppIcon";
import type { BridgeState } from "./useBridge";

const field = "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13.5px] outline-none focus:border-lane-b/50";

/** "Paste from ChatGPT": the fallback when an app can't call Baton's tools itself. */
export function ImportCard({ br, onDone }: { br: BridgeState; onDone: (e: BridgeEvent | null) => void }) {
  const [app, setApp] = useState<ExternalApp>("chatgpt");
  const [userMessage, setUserMessage] = useState("");
  const [reply, setReply] = useState("");
  const ready = userMessage.trim() && reply.trim() && !br.importing;
  return (
    <section id="import" className="surface scroll-mt-4 rounded-2xl p-4" aria-label="Import an exchange">
      <div className="flex items-center gap-2.5">
        <ClipboardPaste size={16} className="text-lane-c" />
        <div className="text-[15px] font-medium">Paste from {APP_NAME[app]}</div>
      </div>
      <p className="mt-1 text-[12.5px] text-muted">
        Paste the last exchange. Baton extracts what you decided and rejected, and the other app can pull it.
      </p>
      <form
        className="mt-3 flex flex-col gap-2.5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) return;
          const ev = await br.importExchange({ app, user_message: userMessage.trim(), assistant_reply: reply.trim() });
          if (ev) {
            setUserMessage("");
            setReply("");
            onDone(ev);
          }
        }}
      >
        <div className="flex gap-1 rounded-xl bg-black/30 p-1" role="radiogroup" aria-label="From which app">
          {(["chatgpt", "claude"] as const).map((a) => (
            <button key={a} type="button" role="radio" aria-checked={app === a} onClick={() => setApp(a)}
              className={cx("flex-1 rounded-lg py-1 text-[12.5px] transition-colors", app === a ? "bg-white/[0.08] text-fg" : "text-muted hover:text-fg")}>
              {APP_NAME[a]}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Your message
          <textarea rows={3} value={userMessage} onChange={(e) => setUserMessage(e.target.value)} className={field}
            placeholder="No Redis, we're on a free tier. Let's use an in-process TTL cache." />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {APP_NAME[app]}'s reply
          <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} className={field}
            placeholder="Understood. Next, wrap recall() in a TTLCache keyed by (bank, query)." />
        </label>
        <Button type="submit" variant="primary" disabled={!ready}>
          {br.importing ? "Recording…" : "Record to the baton"}
        </Button>
      </form>
    </section>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="baton-text w-4 shrink-0 font-display text-xl leading-none">{n}</span>
      <div className="min-w-0 flex-1 text-[13.5px] leading-relaxed">{children}</div>
    </li>
  );
}

function Url({ url }: { url: string }) {
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg bg-black/40 px-2.5 py-1.5 font-mono text-[11.5px] text-muted" title={url}>{url}</code>
      <CopyButton text={url} />
    </div>
  );
}

/** How to connect Claude Desktop, ChatGPT and claude.ai to Baton's MCP tools. */
export function SetupDrawer({ open, onClose, setup, project }: {
  open: boolean; onClose: () => void; setup: BridgeSetup | null; project: string;
}) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open, onClose]);

  const toImport = () => {
    onClose();
    document.getElementById("import")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex justify-end bg-black/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          exit={{ opacity: 0 }} onClick={onClose}>
          <motion.aside role="dialog" aria-modal="true" aria-label="Connect your apps"
            className="h-full w-[min(480px,100vw)] overflow-y-auto border-l border-white/10 bg-ink-2 p-5"
            initial={{ x: 48 }} animate={{ x: 0 }} exit={{ x: 48 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-3xl">Connect your apps</h2>
              <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-white/[0.06] hover:text-fg"><X size={17} /></button>
            </div>
            {!setup ? (
              <p className="mt-4 text-[13px] text-muted">Loading setup from the backend…</p>
            ) : (
              <div className="mt-5 flex flex-col gap-6">
                <section>
                  <div className="mb-3 flex items-center gap-2.5"><AppIcon app="claude" size={28} /><h3 className="text-[15px] font-medium">Claude Desktop</h3></div>
                  <ol className="flex flex-col gap-3">
                    <Step n={1}>
                      Copy the config snippet.
                      <div className="mt-1.5 rounded-xl bg-black/40 p-2.5">
                        <pre className="max-h-44 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] text-muted">{setup.claude_desktop_config}</pre>
                        <div className="mt-2 flex justify-end"><CopyButton text={setup.claude_desktop_config} label="Copy config" /></div>
                      </div>
                    </Step>
                    <Step n={2}>
                      Paste it into <code className="font-mono text-[12px] text-lane-b">%APPDATA%\Claude\claude_desktop_config.json</code>. If the file already has
                      an <code className="font-mono text-[12px]">mcpServers</code> block, add <code className="font-mono text-[12px]">baton</code> inside it.
                    </Step>
                    <Step n={3}>
                      Restart Claude, then say <span className="text-fg">“pick up the baton for {project}”</span>. A pull shows up here within 2 s.
                    </Step>
                  </ol>
                </section>

                <section>
                  <div className="mb-3 flex items-center gap-2.5"><AppIcon app="chatgpt" size={28} /><h3 className="text-[15px] font-medium">ChatGPT</h3></div>
                  {setup.chatgpt_url ? (
                    <ol className="flex flex-col gap-3">
                      <Step n={1}>Open Settings → Apps &amp; Connectors → Advanced, and turn on Developer mode.</Step>
                      <Step n={2}>Create a connector with this URL:<Url url={setup.chatgpt_url} /></Step>
                      <Step n={3}>In a chat, enable the Baton connector and plan as usual. Each record shows up here.</Step>
                    </ol>
                  ) : (
                    <p className="text-[13.5px] leading-relaxed text-muted">
                      No public URL is set, so ChatGPT can't reach Baton's tools directly. Use <b className="font-medium text-fg">Import</b> to paste an exchange, and
                      <b className="font-medium text-fg"> Copy baton</b> to take the contract back into ChatGPT.
                      <button onClick={toImport} className="mt-2 block text-[13px] text-lane-b hover:underline">Go to the Import box</button>
                    </p>
                  )}
                </section>

                {setup.public_claude_url && (
                  <section>
                    <div className="mb-3 flex items-center gap-2.5"><AppIcon app="claude" size={28} /><h3 className="text-[15px] font-medium">claude.ai</h3></div>
                    <p className="text-[13.5px] text-muted">Add a custom connector with this URL:</p>
                    <Url url={setup.public_claude_url} />
                  </section>
                )}

                <div className="flex gap-2.5 rounded-xl border border-cool/25 bg-cool/[0.06] p-3 text-[12.5px] text-amber-100">
                  <Lock size={14} className="mt-0.5 shrink-0 text-cool" />
                  <span>These URLs contain a private token. Anyone with the URL can read and write this project's baton, so don't share them or post them.</span>
                </div>
              </div>
            )}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
