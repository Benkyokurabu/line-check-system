export const DEFAULT_VISIBLE_CANDIDATE_COUNT = 20;

export function candidateIsDone(candidate) {
  return candidate?.status === "confirmed" || candidate?.status === "dismissed";
}

export function candidateHasError(candidate) {
  return candidate?.status === "notion_failed" || Boolean(candidate?.notion_error) ||
    (candidate?.attendance_candidate_items ?? []).some((item) => item?.status === "notion_failed" || Boolean(item?.notion_error));
}

export function candidateActionPriority(candidate) {
  if (candidateHasError(candidate)) return 0;
  return 1;
}

export function actionCandidatesForReview(candidates) {
  return [...(candidates ?? [])]
    .filter((candidate) => !candidateIsDone(candidate))
    .sort((a, b) => candidateActionPriority(a) - candidateActionPriority(b));
}

export function doneCandidatesForReview(candidates) {
  return (candidates ?? []).filter(candidateIsDone);
}

export function visibleCandidatesForReview(candidates, reviewTab) {
  const actionCandidates = actionCandidatesForReview(candidates);
  const doneCandidates = doneCandidatesForReview(candidates);
  if (reviewTab === "action") return actionCandidates;
  if (reviewTab === "done") return doneCandidates;
  return [...actionCandidates, ...doneCandidates];
}

export function visibleCandidateCountAfterReload({
  candidates,
  reviewTab,
  keepVisibleCandidateId,
  currentCount,
  defaultCount = DEFAULT_VISIBLE_CANDIDATE_COUNT,
}) {
  if (!keepVisibleCandidateId) return defaultCount;
  const visibleCandidates = visibleCandidatesForReview(candidates, reviewTab);
  const candidateIndex = visibleCandidates.findIndex((candidate) => candidate?.id === keepVisibleCandidateId);
  if (candidateIndex < 0) return currentCount;
  return Math.max(currentCount, defaultCount, candidateIndex + 1);
}
