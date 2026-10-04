export const WORKER_MESSAGE = 'Background scraping is not connected yet. Worker setup is the next step; your saved records remain available.';
export function requireWorker() { throw new Error(WORKER_MESSAGE); }
