import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateContrastRatio,
  CALENDAR_ACCESSIBILITY_TOKENS
} from '../src/accessibility-calendar-tokens.js';

describe('Calendar Accessibility Tokens (WCAG AA Compliance)', () => {
  const WCAG_AA_TEXT_CONTRAST = 4.5;

  it('verifies light mode range middle text passes WCAG AA (>= 4.5:1)', () => {
    const tokens = CALENDAR_ACCESSIBILITY_TOKENS.light;
    const ratio = calculateContrastRatio(tokens.rangeMiddleBackground, tokens.rangeMiddleText);
    assert.ok(ratio >= WCAG_AA_TEXT_CONTRAST, `Light mode contrast ${ratio.toFixed(2)}:1 must be >= 4.5:1`);
  });

  it('verifies dark mode range middle text passes WCAG AA (>= 4.5:1)', () => {
    const tokens = CALENDAR_ACCESSIBILITY_TOKENS.dark;
    const ratio = calculateContrastRatio(tokens.rangeMiddleBackground, tokens.rangeMiddleText);
    assert.ok(ratio >= WCAG_AA_TEXT_CONTRAST, `Dark mode contrast ${ratio.toFixed(2)}:1 must be >= 4.5:1`);
  });

  it('verifies dark mode range edge endpoints pass WCAG AAA (>= 7.0:1)', () => {
    const tokens = CALENDAR_ACCESSIBILITY_TOKENS.dark;
    const ratio = calculateContrastRatio(tokens.rangeEdgeBackground, tokens.rangeEdgeText);
    assert.ok(ratio >= 7.0, `Endpoint contrast ${ratio.toFixed(2)}:1 must be >= 7.0:1`);
  });
});
