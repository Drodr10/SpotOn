import { useState, useEffect, useRef } from 'react';

const API_IP = process.env.EXPO_PUBLIC_IP ?? '';

export type PricingLineItem = {
  tier: string;
  rate: number;
  units: number;
  subtotal: number;
};

export type PricingResult = {
  subtotal: number;
  platform_fee: number;
  host_payout: number;
  total: number;
  tier: string;
  units: number;
  rate: number;
  line_items?: PricingLineItem[];
};

export function usePricingPreview(
  listingId: string,
  startTime: Date | null,
  endTime: Date | null,
): {
  pricing: PricingResult | null;
  loading: boolean;
  error: string | null;
} {
  const [pricing, setPricing] = useState<PricingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const startMs = startTime?.getTime() ?? null;
  const endMs = endTime?.getTime() ?? null;

  useEffect(() => {
    if (startMs === null || endMs === null) {
      setPricing(null);
      setError(null);
      setLoading(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (controllerRef.current) controllerRef.current.abort();

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setLoading(true);
      setError(null);

      try {
        const start = encodeURIComponent(new Date(startMs).toISOString());
        const end = encodeURIComponent(new Date(endMs).toISOString());
        const url = `https://${API_IP}/api/reservations/preview?listing_id=${encodeURIComponent(listingId)}&start_time=${start}&end_time=${end}`;
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            'ngrok-skip-browser-warning': 'true',
            Accept: 'application/json',
          },
        });
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          const text = await res.text();
          setError(`Non-JSON response from server (${res.status}): ${text.slice(0, 80)}`);
          setPricing(null);
          return;
        }
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? 'Pricing unavailable');
          setPricing(null);
        } else {
          setPricing({
            subtotal: parseFloat(json.subtotal),
            platform_fee: parseFloat(json.platform_fee),
            host_payout: parseFloat(json.host_payout),
            total: parseFloat(json.total),
            tier: json.tier,
            units: parseFloat(json.units),
            rate: parseFloat(json.rate),
            line_items: json.line_items?.map((li: any) => ({
              tier: li.tier,
              rate: parseFloat(li.rate),
              units: parseFloat(li.units),
              subtotal: parseFloat(li.subtotal),
            })),
          });
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          setError('Failed to fetch pricing');
          setPricing(null);
        }
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (controllerRef.current) controllerRef.current.abort();
    };
  }, [listingId, startMs, endMs]);

  return { pricing, loading, error };
}
