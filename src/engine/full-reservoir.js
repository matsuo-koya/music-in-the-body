export function createFullReservoir({ seed, mode, sampleIds = [], url = "/music-on-fly/flywire-v783-full.mofg" }) {
  const worker = new Worker(new URL("./full-reservoir-worker.js", import.meta.url), { type: "module" });
  let readyResolve, readyReject, batchResolve, batchReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  worker.onmessage = ({ data }) => {
    if (data.type === "ready") readyResolve(data.metadata);
    else if (data.type === "batch" && batchResolve) { const resolve = batchResolve; batchResolve = null; batchReject = null; resolve(data); }
    else if (data.type === "error") { (batchReject || readyReject)(new Error(data.message)); batchResolve = null; batchReject = null; }
  };
  worker.onerror = (event) => (batchReject || readyReject)(new Error(event.message || "全脳Workerが停止しました"));
  worker.postMessage({ type: "init", seed, mode, sampleIds, url });
  return {
    ready,
    batch(count = 16, feedback = 0) {
      if (batchResolve) return Promise.reject(new Error("全脳更新は処理中です"));
      return new Promise((resolve, reject) => { batchResolve = resolve; batchReject = reject; worker.postMessage({ type: "batch", count, feedback }); });
    },
    terminate() { worker.terminate(); },
  };
}
