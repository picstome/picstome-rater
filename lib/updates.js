const UPDATE_CHECK_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

function shouldCheckForUpdates(
  lastCheckAt,
  now,
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
) {
  const last = Number(lastCheckAt);
  if (!Number.isFinite(last) || last <= 0) return true;
  return now - last >= intervalMs;
}

function daysSinceCheck(lastCheckAt, now) {
  const last = Number(lastCheckAt);
  if (!Number.isFinite(last) || last <= 0) return null;
  return Math.max(0, Math.floor((now - last) / (24 * 60 * 60 * 1000)));
}

module.exports = {
  UPDATE_CHECK_INTERVAL_MS,
  shouldCheckForUpdates,
  daysSinceCheck,
};
