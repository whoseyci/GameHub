import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const publicDir = join(root, 'public');
const outDir = join(root, 'artifacts', 'playwright');
mkdirSync(outDir, { recursive: true });

function assert(cond, message) {
  if (!cond) throw new Error(message);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const contentType = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') pathname = '/index.html';
      const filePath = normalize(join(publicDir, pathname));
      const safePath = filePath.startsWith(publicDir) ? filePath : join(publicDir, 'index.html');
      const actual = existsSync(safePath) ? safePath : join(publicDir, 'index.html');
      const data = await readFile(actual);
      res.statusCode = 200;
      res.setHeader('content-type', contentType[extname(actual)] || 'application/octet-stream');
      res.end(data);
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  return {
    server,
    url: `http://127.0.0.1:${addr.port}`,
    async close() { await new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())); },
  };
}

async function screenshot(page, name) {
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true });
}

async function configureLocal(page, gameId, seats) {
  await page.evaluate(({ gameId, seats }) => {
    localSeats = seats;
    renderLocalSeats();
    refreshLocalTiles();
    _localPick = gameId;
    markLocalPick();
  }, { gameId, seats });
}

async function bootPage(page, baseUrl) {
  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.stack || err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`console.${msg.type()}: ${msg.text()}`);
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('button:has-text("Pass & Play")').click();
  await page.waitForSelector('#localPick.active');
  return consoleErrors;
}

async function runDesktopSuite(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = await bootPage(page, baseUrl);

  await configureLocal(page, 'flip7', [
    { name: 'P1', bot: false },
    { name: 'P2', bot: false },
  ]);
  await page.locator('#localPick button:has-text("Start")').click();
  await page.waitForSelector('#gameScreen.active');
  await screenshot(page, 'desktop-flip7-start');
  await page.locator('#f7Controls .btn.green').click();
  page.once('dialog', (d) => d.accept());
  await page.locator('#gameScreen .game-topbar .icon-btn').first().click();
  await page.waitForSelector('#menuScreen.active');
  await page.waitForTimeout(2500);
  assert(await page.locator('#f7Controls').count() === 0, 'Desktop: Flip7 controls leaked back after quitting mid-animation');
  assert(await page.locator('#f7DealerWrap').count() === 0, 'Desktop: Flip7 dealer leaked back after quitting mid-animation');
  assert(await page.locator('[data-f7-seat]').count() === 0, 'Desktop: Flip7 board nodes leaked back after quitting mid-animation');
  await screenshot(page, 'desktop-after-flip7-quit');

  await page.locator('button:has-text("Pass & Play")').click();
  await configureLocal(page, 'skyjo', [
    { name: 'P1', bot: false },
    { name: 'P2', bot: false },
  ]);
  await page.locator('#localPick button:has-text("Start")').click();
  await page.waitForSelector('#gameScreen.active');
  assert(await page.locator('.qwixx-dice-zone').count() === 0, 'Desktop: Qwixx dice zone leaked into Skyjo');
  assert(await page.locator('#topArea .piles').evaluate((el) => getComputedStyle(el).display) !== 'none', 'Desktop: Skyjo piles should be visible');
  await screenshot(page, 'desktop-skyjo-start');

  if (errors.length) throw new Error(errors.join('\n'));
  await page.close();
}

async function runMobileSuite(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  const errors = await bootPage(page, baseUrl);

  await configureLocal(page, 'qwixx', [
    { name: 'Human', bot: false },
    { name: 'Bot', bot: true, difficulty: 'medium' },
  ]);
  await page.locator('#localPick button:has-text("Start")').click();
  await page.waitForSelector('#gameScreen.active');
  await screenshot(page, 'mobile-qwixx-before-throw');

  // "Pending white decision" used to be a raw field on view.state, but the
  // view-shape standardization (tests/view-shape) requires hub-canonical
  // fields only on view.state. The same information is now derivable from
  // view.state.players[i].status === 'active' during the white phase (i.e.
  // the seat still needs to decide). view.qwixx.allPlayers also exposes a
  // .waiting flag computed identically; using view.state keeps the test
  // hub-shape-aware.
  const readPending = () => page.evaluate(() => {
    const v = localEngine.viewFor(localDisplaySeat());
    const inWhitePhase = v?.qwixx?.phase === 'WHITE_PHASE';
    if (!inWhitePhase) return [];
    return (v?.state?.players || []).filter((p) => p.status === 'active').map((p) => p.seat);
  });
  let pending = await readPending();
  assert(pending.includes(1), 'Mobile: Qwixx bot should still be pending before throw');
  await page.waitForTimeout(1200);
  pending = await readPending();
  assert(pending.includes(1), 'Mobile: Qwixx bot acted before the throw');
  await page.locator('#qwixxThrowBtn').click();
  await page.waitForTimeout(2600);
  pending = await readPending();
  assert(!pending.includes(1), 'Mobile: Qwixx bot did not act after the throw');
  await screenshot(page, 'mobile-qwixx-after-throw');

  page.once('dialog', (d) => d.accept());
  await page.locator('#gameScreen .game-topbar .icon-btn').first().click();
  await page.waitForSelector('#menuScreen.active');
  await page.locator('button:has-text("Pass & Play")').click();

  await configureLocal(page, 'flip7', [
    { name: 'H1', bot: false },
    { name: 'Bot', bot: true, difficulty: 'easy' },
  ]);
  await page.locator('#localPick button:has-text("Start")').click();
  await page.waitForSelector('#gameScreen.active');
  await page.locator('#f7Controls .btn.secondary').click();
  await page.waitForTimeout(2200);
  const seq = await page.evaluate(() => localEngine.viewFor(localDisplaySeat()).flip7.seq);
  assert(seq >= 2, 'Mobile: Flip7 bot did not take its turn');
  await screenshot(page, 'mobile-flip7-bot-turn');

  if (errors.length) throw new Error(errors.join('\n'));
  await page.close();
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    await runDesktopSuite(browser, server.url);
    await runMobileSuite(browser, server.url);
    console.log(`Playwright browser smoke passed against ${server.url}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
