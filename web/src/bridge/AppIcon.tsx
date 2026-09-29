import { Feather, MessageCircle } from "lucide-react";
import type { BridgeApp } from "../api/bridge";
import { BatonMark } from "../components/brand";
import { appLane } from "../lib/lanes";

export function AppIcon({ app, size = 32 }: { app: BridgeApp; size?: number }) {
  const lane = appLane(app);
  const icon = size * 0.5;
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-xl"
      style={{ width: size, height: size, background: lane.soft, color: lane.color, boxShadow: `inset 0 0 0 1px ${lane.ring}` }}>
      {app === "chatgpt" ? <MessageCircle size={icon} /> : app === "claude" ? <Feather size={icon} /> : <BatonMark size={icon + 2} />}
    </span>
  );
}
