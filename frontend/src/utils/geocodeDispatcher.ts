import type { GeocodeResult } from './geocode';

type GeocodeFn = (q: string, opts?: { signal?: AbortSignal | null; timeoutMs?: number }) => Promise<GeocodeResult>;

export class GeocodeDispatcher {
  private geocode: GeocodeFn;
  private debounceMs: number;
  private currentToken = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private pendingResolve: ((r: GeocodeResult) => void) | null = null;

  constructor(geocode: GeocodeFn, debounceMs = 300) {
    this.geocode = geocode;
    this.debounceMs = debounceMs;
  }

  // search returns a promise that resolves when the debounced geocode finishes
  // and was the latest query. If cancelled or superseded, it resolves to null.
  search(query: string): Promise<GeocodeResult> {
    this.currentToken += 1;
    const token = this.currentToken;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    // abort any in-flight
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    return new Promise<GeocodeResult>((resolve) => {
      // If there is a prior pending promise, resolve it as superseded.
      if (this.pendingResolve) {
        try {
          this.pendingResolve(null);
        } catch (_) {}
        this.pendingResolve = null;
      }
      this.pendingResolve = resolve;

      this.debounceTimer = setTimeout(async () => {
        // clear pendingResolve once we start executing
        this.pendingResolve = null;
        // If token was superseded before timeout, resolve null
        if (token !== this.currentToken) return resolve(null);
        const controller = new AbortController();
        this.abortController = controller;
        try {
          const res = await this.geocode(query, { signal: controller.signal, timeoutMs: 5000 });
          // only apply if still latest
          if (token === this.currentToken) resolve(res);
          else resolve(null);
        } catch (e) {
          // treat errors (including abort) as null result
          resolve(null);
        } finally {
          if (this.abortController === controller) this.abortController = null;
        }
      }, this.debounceMs);
    });
  }

  cancel() {
    this.currentToken += 1; // invalidate pending
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.pendingResolve) {
      try {
        this.pendingResolve(null);
      } catch (_) {}
      this.pendingResolve = null;
    }
  }
}

export default GeocodeDispatcher;
