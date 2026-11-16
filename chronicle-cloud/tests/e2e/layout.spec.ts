// Every main page fits the screen from a small phone to a wide desktop: no sideways scrolling,
// and nothing wider than the viewport. Synthetic sample content only.
import { expect, test, type Page } from '@playwright/test';
import { enrollAsPlayer, signInAsDm } from './support.ts';

const WIDTHS = [320, 375, 412, 768, 1920];

const PLAYER_ROUTES = [
  '/', '/wiki/port-vellmoor', '/wiki/captain-merrin-vael', '/browse/character', '/browse/session', '/search?q=port',
  '/categories', '/timeline', '/connections', '/news', '/news/archive', '/news/fires-on-the-coast-road', '/maps',
];
const DM_ROUTES = [
  '/dm', '/dm/new', '/dm/edit/port-vellmoor', '/dm/news', '/dm/news/new', '/dm/news/edit/harbourmaster-secret-talks',
  '/dm/media', '/dm/notes', '/dm/access', '/dm/settings', '/dm/timeline', '/dm/import', '/dm/connect',
];

/** Elements that stick out past the right edge of the viewport (ignoring scroll containers' contents). */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const pageOverflow = document.documentElement.scrollWidth - vw;
    const inScroller = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
      }
      return false;
    };
    const wide = Array.from(document.querySelectorAll('main *'))
      .filter((el) => el.getBoundingClientRect().right > vw + 1 && !inScroller(el))
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
    return { pageOverflow, wide };
  });
}

async function sweep(page: Page, routes: string[]) {
  const problems: string[] = [];
  for (const route of routes) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(route);
      await expect(page.locator('main#main')).toBeVisible();
      await page.waitForLoadState('networkidle');
      const { pageOverflow, wide } = await overflow(page);
      if (pageOverflow > 1 || wide.length) problems.push(`${route} @${width}px: page +${pageOverflow}px ${wide.join(', ')}`);
    }
  }
  expect(problems, problems.join('\n')).toEqual([]);
}

test.describe('Layout', () => {
  test.setTimeout(240_000);
  test('player pages fit every screen width', async ({ page }) => {
    await enrollAsPlayer(page, 'Layout Player');
    await sweep(page, PLAYER_ROUTES);
  });
  test('DM pages fit every screen width', async ({ page }) => {
    await signInAsDm(page);
    await sweep(page, DM_ROUTES);
  });
});
