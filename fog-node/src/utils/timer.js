/**
 * Timer utility — allows the adaptive sampler to modify the
 * aggregation window duration at runtime without restarting the process.
 */

import { flushWindows } from '../processors/aggregator.js';
import { evaluateAndAdapt } from '../processors/adaptiveSampler.js';

let currentWindowMs = parseInt(process.env.AGGREGATION_WINDOW_MS || '10000', 10);
let timer = null;

/**
 * Change the aggregation window duration.
 * Clears the current timer and starts a new one.
 *
 * @param {number} newWindowMs - New window duration in milliseconds
 */
export function setWindowDuration(newWindowMs) {
  if (newWindowMs === currentWindowMs && timer !== null) return;

  if (timer) clearInterval(timer);
  currentWindowMs = newWindowMs;

  timer = setInterval(() => {
    flushWindows();
    const result = evaluateAndAdapt();
    if (result.mode !== 'NORMAL') {
      console.log(
        `[AdaptiveSampler] Mode=${result.mode} | ` +
        `AnomalyRate=${result.maxAnomalyRate}% | ` +
        `Window=${result.newWindowMs}ms`
      );
    }
  }, currentWindowMs);

  console.log(`[Timer] Aggregation window set to ${currentWindowMs}ms`);
}

/** Get current window duration. */
export function getCurrentWindowMs() {
  return currentWindowMs;
}
