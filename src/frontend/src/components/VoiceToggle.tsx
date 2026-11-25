import { Volume2, VolumeX } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  isVoiceMuted,
  setVoiceMuted,
  subscribeVoiceMuted,
} from "../lib/piece-voices";

/** On/off switch for the chess pieces' spoken lines. Remembered per browser. */
export function VoiceToggle() {
  const muted = useSyncExternalStore(
    subscribeVoiceMuted,
    isVoiceMuted,
    () => false,
  );
  return (
    <button
      type="button"
      onClick={() => setVoiceMuted(!muted)}
      data-ocid="board_toolbar.voices.toggle"
      aria-pressed={!muted}
      aria-label={muted ? "Turn piece voices on" : "Turn piece voices off"}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        muted
          ? "bg-background text-muted-foreground border border-border hover:bg-muted"
          : "bg-primary/10 text-primary border border-primary/30"
      }`}
    >
      {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
      <span>Voices</span>
    </button>
  );
}

export default VoiceToggle;
