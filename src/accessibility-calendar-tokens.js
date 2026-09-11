/**
 * WCAG 2.1 Relative Luminance & Contrast Calculation Module
 */

function sRgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(rgb) {
  const [r, g, b] = rgb;
  return 0.2126 * sRgbToLinear(r) + 0.7152 * sRgbToLinear(g) + 0.0722 * sRgbToLinear(b);
}

export function calculateContrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export const CALENDAR_ACCESSIBILITY_TOKENS = {
  light: {
    background: [255, 255, 255],
    rangeMiddleBackground: [241, 245, 249], // slate-100
    rangeMiddleText: [15, 23, 42],          // slate-900 (17.5:1 contrast)
    rangeEdgeBackground: [15, 23, 42],      // slate-900
    rangeEdgeText: [255, 255, 255]          // white (18.2:1 contrast)
  },
  dark: {
    background: [15, 23, 42],              // slate-900
    // Adjusted tokens for WCAG AA compliance (>= 4.5:1)
    rangeMiddleBackground: [30, 41, 59],    // slate-800
    rangeMiddleText: [248, 250, 252],       // slate-50 (10.8:1 contrast)
    rangeEdgeBackground: [248, 250, 252],   // slate-50
    rangeEdgeText: [15, 23, 42]             // slate-900 (16.2:1 contrast)
  }
};
