// The last request describes the current context; totals are cumulative billing activity.
export function contextUsage(usage) {
  const used = usage?.last?.totalTokens;
  const capacity = usage?.modelContextWindow;
  return {
    used: Number.isFinite(used) && used >= 0 ? used : null,
    capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
    percent: Number.isFinite(used) && used >= 0 && Number.isFinite(capacity) && capacity > 0
      ? Math.min(100, Math.max(0, used / capacity * 100)) : null,
  };
}

export function quotaForModel(snapshot, model) {
  const buckets = snapshot?.rateLimitsByLimitId || {};
  const matching = Object.values(buckets).filter(x => x?.normalModelSlug === model);
  const bucket = buckets[model] || (matching.length === 1 ? matching[0] : null)
    || buckets.codex || (snapshot?.rateLimits?.limitId === 'codex' ? snapshot.rateLimits : null);
  const window = [bucket?.primary, bucket?.secondary].find(x => x?.windowDurationMins === 7 * 24 * 60);
  return {
    label: bucket?.limitName || bucket?.limitId || 'Codex',
    remainingPercent: Number.isFinite(window?.usedPercent) ? Math.min(100, Math.max(0, 100 - window.usedPercent)) : null,
    resetsAt: Number.isFinite(window?.resetsAt) ? window.resetsAt : null,
    shared: bucket?.limitId === 'codex',
  };
}

export function validateSelection(models, selection) {
  if (!selection || typeof selection.model !== 'string' || typeof selection.effort !== 'string')
    throw new Error('모델과 effort를 선택해 주세요.');
  const model = models.find(x => x.model === selection.model);
  if (!model) throw new Error('현재 선택할 수 없는 모델입니다. 모델 목록을 새로고침해 주세요.');
  if (!model.supportedReasoningEfforts.some(x => x.reasoningEffort === selection.effort))
    throw new Error('이 모델에서 지원하지 않는 effort입니다.');
  return { model: model.model, effort: selection.effort };
}

export function catalogDefaults(models, config = {}) {
  const model = models.find(x => x.model === config.model) || models.find(x => x.isDefault) || models[0];
  if (!model) return { model: null, effort: null };
  const configured = model.model === config.model && config.model_reasoning_effort;
  const effort = model.supportedReasoningEfforts.some(x => x.reasoningEffort === configured)
    ? configured : model.defaultReasoningEffort;
  return { model: model.model, effort };
}

// Rolling updates can omit a quota window; keep the last observed window.
export function mergeRateLimits(snapshot, update) {
  const id = update?.limitId;
  if (!id) return snapshot;
  const previous = snapshot?.rateLimitsByLimitId?.[id] || (snapshot?.rateLimits?.limitId === id ? snapshot.rateLimits : {});
  const bucket = { ...previous };
  for (const [key, value] of Object.entries(update)) if (value !== null && value !== undefined) bucket[key] = value;
  return { ...snapshot, rateLimits: snapshot?.rateLimits?.limitId === id ? bucket : snapshot?.rateLimits,
    rateLimitsByLimitId: { ...snapshot?.rateLimitsByLimitId, [id]: bucket } };
}
