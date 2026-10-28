import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { AUDIO_ENTRY, type AudioEntry, type ManualAudio } from "./manual-audio.js";

// Pi has no native transcript button or reactive entry label. This small component
// keeps the label live without replacing the editor, tool expansion or input focus.
// Its own labels contain only single-column characters (no arbitrary model text).
export function registerAudioRenderer(pi: ExtensionAPI, audio: ManualAudio) {
  pi.registerEntryRenderer<AudioEntry>(AUDIO_ENTRY, (entry, _options, theme: Theme) => {
    const card = entry.data;
    if (!card) return;
    return {
      render(width: number): string[] {
        const label = audio.label(card);
        if (!label || width < 1) return [];
        return [theme.fg("accent", Array.from(label).slice(0, width).join(""))];
      },
      invalidate() {},
      handleMouse(event: { type: string; button: string; x: number; y: number }) {
        if (event.type !== "click" || event.button !== "left" || event.y !== 0 || event.x < 0) return;
        let start = 0;
        for (const control of audio.controls(card)) {
          const end = start + Array.from(`[ ${control.label} ]`).length;
          if (event.x >= start && event.x < end) {
            if (!control.action) return;
            void audio.activate(card, control.action);
            return { handled: true, render: true };
          }
          start = end + 2;
        }
      },
    };
  });
}
