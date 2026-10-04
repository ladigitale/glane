/**
 * Live link between the agent bridge and the mounted sequencer page.
 * The sequencer registers itself while connected; the bridge uses it to
 * reload a freshly written arrangement and drive the transport.
 */
export type SequencerLink = {
  projectId(): string | null;
  /** Re-read project / tracks / clips from IndexedDB (keeps the audio engine). */
  reloadFromDb(): Promise<void>;
  play(fromBar?: number): Promise<{ playing: boolean; audio: AudioContextState | "none" }>;
  stop(): void;
  isPlaying(): boolean;
  audioState(): AudioContextState | "none";
};

let current: SequencerLink | null = null;
const waiters = new Set<(link: SequencerLink) => void>();

export function registerSequencer(link: SequencerLink): () => void {
  current = link;
  for (const w of [...waiters]) w(link);
  return () => {
    if (current === link) current = null;
  };
}

export function sequencer(): SequencerLink | null {
  return current;
}

/** Resolve once a sequencer for `projectId` is mounted (or null on timeout). */
export function waitForSequencer(
  projectId: string,
  timeoutMs = 4_000,
): Promise<SequencerLink | null> {
  if (current?.projectId() === projectId) return Promise.resolve(current);
  return new Promise((resolve) => {
    const started = Date.now();
    const poll = setInterval(() => {
      if (current?.projectId() === projectId) done(current);
      else if (Date.now() - started > timeoutMs) done(null);
    }, 100);
    const onLink = (l: SequencerLink) => {
      if (l.projectId() === projectId) done(l);
    };
    function done(l: SequencerLink | null) {
      clearInterval(poll);
      waiters.delete(onLink);
      resolve(l);
    }
    waiters.add(onLink);
  });
}
