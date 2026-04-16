export function splitEvenly(totalItems: number, numPeople: number): number[] {
  if (numPeople <= 0) throw new Error('numPeople must be > 0');
  const base = Math.floor(totalItems / numPeople);
  const extras = totalItems % numPeople;
  return Array.from({ length: numPeople }, (_, i) =>
    base + (i < extras ? 1 : 0),
  );
}
