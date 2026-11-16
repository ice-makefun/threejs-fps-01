// Dustline look plan, in one place. Six values and one accent hue; the lighting makes
// every shade the game needs, so no other colour appears in the code. The same six names
// are the CSS custom properties in index.html: a desert dusk — warm dark ground, pale
// sand ink, amber accent for the things that matter (crosshair, hitmarker, bombsites).
export const PALETTE = {
  canvas: '#191512',
  surface: '#2b241b',
  hairline: '#4a3f2e',
  ink: '#f0e8d5',
  muted: '#a89a7d',
  accent: '#f0a830',
};

export function shade(name) {
  return PALETTE[name];
}
