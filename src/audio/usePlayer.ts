import { useCallback, useEffect, useRef, useState } from 'react';
import { play, stopAll, type NoteEvent } from './synth';

export interface StartOptions {
  /** Checked when playback reaches the end: return true to start again. */
  loop?: () => boolean;
  /** Called when playback finishes or is stopped (not between loop repetitions). */
  onDone?: () => void;
}

/**
 * Playback state for a component: `playing` is the id of what is currently playing (so each
 * play button can turn into a stop button), `start` plays events (stopping anything else), and
 * `stop` stops. Playback stops when the component unmounts.
 */
export function usePlayer() {
  const [playing, setPlaying] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopAll();
    };
  }, []);

  const start = useCallback((id: string, events: NoteEvent[], opts: StartOptions = {}) => {
    const run = () =>
      play(events, (reason) => {
        if (reason === 'ended' && opts.loop?.() && mounted.current) {
          run();
          return;
        }
        if (mounted.current) setPlaying((p) => (p === id ? null : p));
        opts.onDone?.();
      });
    run();
    setPlaying(id);
  }, []);

  const stop = useCallback(() => {
    stopAll();
    setPlaying(null);
  }, []);

  /** Play `id`, or stop it if it is already playing. */
  const toggle = useCallback(
    (id: string, events: () => NoteEvent[], opts?: StartOptions) => {
      if (playing === id) stop();
      else start(id, events(), opts);
    },
    [playing, start, stop],
  );

  return { playing, start, stop, toggle };
}
