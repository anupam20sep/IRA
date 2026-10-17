import { cancelPendingHireReview } from "./cancel.js";

export async function hireSpawnCancel(
  reviewId: string,
  options: { hiveRoot: string },
): Promise<{ ok: true; state: "cancelled" }> {
  await cancelPendingHireReview(options.hiveRoot, reviewId);
  return { ok: true, state: "cancelled" };
}
