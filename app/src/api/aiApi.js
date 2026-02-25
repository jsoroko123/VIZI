export async function checkPlcDebugSession(sessionId) {
  const res = await fetch(`/api/ai/plc-debug-sessions/${encodeURIComponent(sessionId)}`, {
    credentials: "include",
  });
  return { status: res.status };
}
