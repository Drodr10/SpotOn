// NOTE: Static fallback table. For production this should call a tax-rate API
// (e.g. TaxJar, Avalara) — wire that in when the backend is ready. Rates are
// approximate combined state + average local sales/use rates and drift
// year-to-year; treat as "good enough for parking-rental tax estimation."
//
// Each entry comments roughly: state base + estimated average local add-on.

export const US_STATE_TAX_RATES: Record<string, number> = {
  Alabama: 0.0925,        // 4% state + ~5.25% avg local
  Alaska: 0.0176,         // 0% state + ~1.76% avg local
  Arizona: 0.0838,        // 5.6% state + ~2.78% avg local
  Arkansas: 0.0947,       // 6.5% state + ~2.97% avg local
  California: 0.0875,     // 7.25% state + ~1.5% avg local (often higher)
  Colorado: 0.0782,       // 2.9% state + ~4.92% avg local
  Connecticut: 0.0635,    // 6.35% state + 0% local
  Delaware: 0.0,          // No sales tax
  'District of Columbia': 0.06, // 6% state-equivalent
  Florida: 0.075,         // 6% state + ~1.5% avg local
  Georgia: 0.0735,        // 4% state + ~3.35% avg local
  Hawaii: 0.045,          // 4% state + ~0.5% avg local
  Idaho: 0.0603,          // 6% state + ~0.03% avg local
  Illinois: 0.0884,       // 6.25% state + ~2.59% avg local
  Indiana: 0.07,          // 7% state + 0% local
  Iowa: 0.0694,           // 6% state + ~0.94% avg local
  Kansas: 0.087,          // 6.5% state + ~2.2% avg local
  Kentucky: 0.06,         // 6% state + 0% local
  Louisiana: 0.0955,      // 4.45% state + ~5.1% avg local
  Maine: 0.055,           // 5.5% state + 0% local
  Maryland: 0.06,         // 6% state + 0% local
  Massachusetts: 0.0625,  // 6.25% state + 0% local
  Michigan: 0.06,         // 6% state + 0% local
  Minnesota: 0.0753,      // 6.875% state + ~0.65% avg local
  Mississippi: 0.0707,    // 7% state + ~0.07% avg local
  Missouri: 0.0839,       // 4.225% state + ~4.16% avg local
  Montana: 0.0,           // No sales tax
  Nebraska: 0.0697,       // 5.5% state + ~1.47% avg local
  Nevada: 0.0823,         // 6.85% state + ~1.38% avg local
  'New Hampshire': 0.0,   // No sales tax
  'New Jersey': 0.0663,   // 6.625% state + ~0% avg local
  'New Mexico': 0.0782,   // 4.875% state + ~2.94% avg local
  'New York': 0.0852,     // 4% state + ~4.52% avg local (NYC is ~8.875%)
  'North Carolina': 0.0698, // 4.75% state + ~2.23% avg local
  'North Dakota': 0.0697, // 5% state + ~1.97% avg local
  Ohio: 0.0723,           // 5.75% state + ~1.48% avg local
  Oklahoma: 0.0895,       // 4.5% state + ~4.45% avg local
  Oregon: 0.0,            // No sales tax
  Pennsylvania: 0.0634,   // 6% state + ~0.34% avg local
  'Rhode Island': 0.07,   // 7% state + 0% local
  'South Carolina': 0.0744, // 6% state + ~1.44% avg local
  'South Dakota': 0.0644, // 4.5% state + ~1.94% avg local
  Tennessee: 0.0955,      // 7% state + ~2.55% avg local
  Texas: 0.0819,          // 6.25% state + ~1.94% avg local
  Utah: 0.0719,           // 6.1% state + ~1.09% avg local
  Vermont: 0.0624,        // 6% state + ~0.24% avg local
  Virginia: 0.0573,       // 5.3% state + ~0.43% avg local
  Washington: 0.0938,     // 6.5% state + ~2.88% avg local
  'West Virginia': 0.065, // 6% state + ~0.5% avg local
  Wisconsin: 0.0543,      // 5% state + ~0.43% avg local
  Wyoming: 0.0533,        // 4% state + ~1.33% avg local
};

export const DEFAULT_TAX_RATE = 0.07;
