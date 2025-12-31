export type Point = { x: number; y: number };

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function dist(a: Point, b: Point) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function polygonArea(pts: Point[]) {
  // Shoelace formula (absolute area) in px^2
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(sum) / 2;
}

export type DisplayUnit = "m" | "cm" | "mm" | "ft" | "in";

export function unitToMetersFactor(unit: DisplayUnit) {
  switch (unit) {
    case "m":
      return 1;
    case "cm":
      return 0.01;
    case "mm":
      return 0.001;
    case "ft":
      return 0.3048;
    case "in":
      return 0.0254;
  }
}

export function formatLength(meters: number, unit: DisplayUnit) {
  const factor = unitToMetersFactor(unit);
  const v = meters / factor;
  if (unit === "mm") return `${Math.round(v)} mm`;
  if (unit === "cm") return `${v.toFixed(1)} cm`;
  if (unit === "m") return `${v.toFixed(2)} m`;
  if (unit === "ft") return `${v.toFixed(2)} ft`;
  if (unit === "in") return `${v.toFixed(1)} in`;
  return `${meters.toFixed(2)} m`;
}

export function formatArea(m2: number, unit: DisplayUnit) {
  const factor = unitToMetersFactor(unit);
  const v = m2 / (factor * factor);
  if (unit === "mm") return `${Math.round(v)} mm²`;
  if (unit === "cm") return `${v.toFixed(1)} cm²`;
  if (unit === "m") return `${v.toFixed(2)} m²`;
  if (unit === "ft") return `${v.toFixed(2)} ft²`;
  if (unit === "in") return `${v.toFixed(1)} in²`;
  return `${m2.toFixed(2)} m²`;
}
