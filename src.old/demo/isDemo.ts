export function isDemoMode() {
  return import.meta.env.VITE_DEMO_MODE === "true";
}
