import { get, set } from "@supersoniks/concorde/utils";
import type { Sample } from "@glane/core-model";
import { db } from "./db.js";

type QueueBatch = {
  dataProvider?: string;
};

/**
 * Refresh one loaded sonic-queue row from IndexedDB — avoids remounting the queue
 * when processing / ML tags evolve on a sample already on screen.
 */
export async function patchSampleInQueue(
  queueDp: string,
  sampleId: string,
): Promise<boolean> {
  const sample = await db.samples.get(sampleId);
  if (!sample || sample.deletedAt) return false;

  const queueState = get(queueDp) as QueueBatch[] | null | undefined;
  if (!Array.isArray(queueState)) return false;

  for (const batch of queueState) {
    const listDp = batch?.dataProvider;
    if (!listDp) continue;
    const listProps = get(listDp) as Sample[] | null | undefined;
    if (!Array.isArray(listProps)) continue;
    const idx = listProps.findIndex((row) => row?.id === sampleId);
    if (idx < 0) continue;

    const next = listProps.slice();
    next[idx] = sample;
    set(listDp, next);
    return true;
  }
  return false;
}
