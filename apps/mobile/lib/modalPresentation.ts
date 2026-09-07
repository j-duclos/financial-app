type Listener = (count: number) => void;

let openCount = 0;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener(openCount);
}

export function getOpenModalCount(): number {
  return openCount;
}

export function subscribeOpenModalCount(listener: Listener): () => void {
  listeners.add(listener);
  listener(openCount);
  return () => {
    listeners.delete(listener);
  };
}

export function acquirePresentedModal(): void {
  openCount += 1;
  notify();
}

export function releasePresentedModal(): void {
  openCount = Math.max(0, openCount - 1);
  notify();
}

/** Tests only. */
export function resetPresentedModalCountForTests(): void {
  openCount = 0;
  notify();
}
