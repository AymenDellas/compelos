/** Native Chromium timezone configuration. No Runtime subscription or page code. */
export const NATIVE_IDENTITY_TAG = "compelos-native-identity-v1";
export const NATIVE_IDENTITY_PATCH = "COMPELOS_NATIVE_IDENTITY_V1";
export function nativeIdentity(profile: { chromiumRuntime?: unknown; tags?: string[] }): boolean {
  return profile.chromiumRuntime === "aliasmode" && profile.tags?.includes(NATIVE_IDENTITY_TAG) === true;
}
export interface NativeClock {
  healthy(): boolean;
  failure(): string | undefined;
  configureTarget(targetId: string): Promise<void>;
  createBlank(): Promise<void>;
  stop(): void;
}
const JS_TYPES = new Set(["page", "iframe", "worker", "service_worker", "shared_worker", "background_page"]);
const FILTER = [...[...JS_TYPES, "tab"].map(type => ({ type, exclude: false })), { exclude: true }];
export async function watchNativeClock(endpoint: string, timezoneId: string, opts: {
  WebSocket?: typeof WebSocket; timeoutMs?: number; onFault?: () => void;
} = {}): Promise<NativeClock> {
  if (!timezoneId) throw new Error("native identity requires a configured timezone");
  new Intl.DateTimeFormat("en-US", { timeZone: timezoneId }).format();
  const Socket = opts.WebSocket ?? WebSocket, socket = new Socket(endpoint), timeout = opts.timeoutMs ?? 10_000;
  const pending = new Map<number, { resolve(v: any): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout>; sessionId?: string }>();
  const sessions = new Map<string, { targetId: string; type: string; detached: boolean; task: Promise<void> }>();
  let next = 0, stopped = false, failed = false, ready = false, failure: string | undefined;
  const fault = (reason = "connection closed") => { if (stopped || failed) return; failed = true; failure = reason; ready = false; try { opts.onFault?.(); } catch {} };
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> => new Promise((resolve, reject) => {
    if (stopped || failed || socket.readyState !== 1) return reject(new Error("native clock is unavailable"));
    if (pending.size >= 256) { fault(); return reject(new Error("native clock command bound exceeded")); }
    const id = ++next, timer = setTimeout(() => { pending.delete(id); fault(method + " " + (sessionId ? sessions.get(sessionId)?.type ?? "detached" : "browser") + " timed out"); reject(new Error("native clock command timed out")); }, timeout);
    pending.set(id, { resolve, reject, timer, sessionId });
    try { socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
    catch { clearTimeout(timer); pending.delete(id); fault(); reject(new Error("native clock connection failed")); }
  });
  const attach = (sessionId: string, info: { targetId: string; type: string }) => {
    const existing = sessions.get(sessionId); if (existing) return existing.task;
    const state = { targetId: info.targetId, type: info.type, detached: false, task: Promise.resolve() };
    sessions.set(sessionId, state);
    state.task = (async () => {
      try {
        const worker = ["worker", "service_worker", "shared_worker"].includes(info.type);
        const timezone = JS_TYPES.has(info.type) ? send("Emulation.setTimezoneOverride", { timezoneId }, sessionId) : Promise.resolve();
        timezone.catch(() => {});
        // A paused worker creates its V8 context only when resumed. Queue the
        // native override first, then release its startup pause; awaiting the
        // override before resume deadlocks context initialization. The first-
        // script fixture checks the resulting clock, not just a later read.
        if (worker) await send("Runtime.runIfWaitingForDebugger", {}, sessionId);
        await timezone;
        // Recursion includes nested workers and cross-process frames. The tab
        // target itself has no JS realm; its child page receives the setting.
        try { await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: FILTER }, sessionId); }
        catch (e) { if (!["worker", "service_worker", "shared_worker"].includes(info.type) || !(e as Error).message.includes("-32601")) throw e; }
        try { if (!worker) await send("Runtime.runIfWaitingForDebugger", {}, sessionId); }
        catch (e) { if (info.type !== "tab" || !(e as Error).message.includes("-32601")) throw e; }
      } catch (e) { if (!state.detached && !stopped) { fault(info.type + ": " + (e as Error).message); throw e; } }
    })();
    state.task.catch(() => {});
    return state.task;
  };
  socket.onmessage = ({ data }) => {
    let message: any; try { message = JSON.parse(String(data)); } catch { fault(); return; }
    if (message.id !== undefined) {
      const item = pending.get(message.id); if (!item) return;
      clearTimeout(item.timer); pending.delete(message.id);
      if (message.error) item.reject(new Error("native clock protocol error " + String(message.error.code) + ": " + String(message.error.message).slice(0,160)));
      else item.resolve(message.result);
    } else if (message.method === "Target.attachedToTarget") {
      const { sessionId, targetInfo } = message.params ?? {};
      if (typeof sessionId === "string" && targetInfo && (JS_TYPES.has(targetInfo.type) || targetInfo.type === "tab")) void attach(sessionId, targetInfo);
    } else if (message.method === "Target.detachedFromTarget") {
      const sessionId = message.params?.sessionId, state = sessions.get(sessionId); if (state) state.detached = true;
      // A completed worker or removed frame can disappear with a command in
      // flight. Retire its own requests, without hiding a timeout on a live target.
      for (const [id, item] of pending) if (item.sessionId === sessionId) {
        clearTimeout(item.timer); pending.delete(id); item.reject(new Error("native clock target closed"));
      }
      sessions.delete(sessionId);
    }
  };
  const stoppedSocket = () => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("native clock connection closed")); }
    pending.clear(); fault();
  };
  socket.onclose = stoppedSocket; socket.onerror = stoppedSocket;
  const stop = () => { if (stopped) return; stopped = true; ready = false; stoppedSocket(); try { socket.close(); } catch {} };
  const configureTarget = async (targetId: string) => {
    if (stopped || failed) throw new Error("native clock is unavailable");
    const existing = [...sessions.values()].find(s => s.targetId === targetId && !s.detached);
    if (existing) { await existing.task; if (existing.detached) throw new Error("native clock target closed"); return; }
    const { targetInfo } = await send("Target.getTargetInfo", { targetId });
    if (!targetInfo || !JS_TYPES.has(targetInfo.type)) throw new Error("native clock target is not an executable page or worker");
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await attach(sessionId, targetInfo);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("native clock connection timed out")), timeout);
      socket.onopen = () => { clearTimeout(timer); resolve(); };
      const previous = socket.onerror; socket.onerror = event => { clearTimeout(timer); previous?.call(socket, event); reject(new Error("native clock connection failed")); };
    });
    // The root attaches to tab containers; their page and worker targets are
    // paused by the recursive sessions until the native timezone is applied.
    await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: "page", exclude: true }, ...FILTER] });
    const { targetInfos } = await send("Target.getTargets");
    for (const target of targetInfos ?? []) if (JS_TYPES.has(target.type)) await configureTarget(target.targetId);
    await Promise.all([...sessions.values()].map(s => s.task));
    if (failed) throw new Error("native clock configuration failed");
    ready = true;
    return { healthy: () => ready && !stopped && !failed, failure: () => failure, configureTarget,
      createBlank: async () => { const { targetId } = await send("Target.createTarget", { url: "about:blank", newWindow: true }); await configureTarget(targetId); }, stop };
  } catch (e) { stop(); throw e; }
}
