// FOMC rate-decision dates (second day of each scheduled meeting), statically
// persisted because the Fed publishes the schedule years ahead and FRED's
// release calendar pads FOMC with filler rows (see catalysts.ts).
// Source: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
// (verified 2026-07-12). Refresh yearly when the Fed posts the next year.
export const FOMC_DECISION_DATES: readonly string[] = [
  "2026-01-28",
  "2026-03-18",
  "2026-04-29",
  "2026-06-17",
  "2026-07-29",
  "2026-09-16",
  "2026-10-28",
  "2026-12-09",
  "2027-01-27",
  "2027-03-17",
  "2027-04-28",
  "2027-06-09",
  "2027-07-28",
  "2027-09-15",
  "2027-10-27",
  "2027-12-08",
];
