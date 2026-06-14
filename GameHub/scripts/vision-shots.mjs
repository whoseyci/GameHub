// Vision script: boot each game on mobile + desktop, take real
// chromium screenshots and dump the actual measured layout. Used for
// in-game layout debugging (the JSDOM smokes can't see what the
// browser actually paints).
//
// Run:  npm run vision        ← writes artifacts/vision/*.png + a
//                                summary of measured boxes per game.
//
// This is what proved the v75 "harden with !important" claim was
// wrong: the screenshots showed left-aligned boards on Skyjo + Flip7
// even though the cascade resolved correctly in JSDOM. Diagnosis
// then traced it to a legacy `.boards-container { flex-wrap: wrap }`
// override; v77 added `flex-wrap: nowrap` on `#mainBoardsContainer`
// to defeat it.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const publicDir = join(root, 'public');
const outDir = join(root, 'artifacts', 'vision');
mkdirSync(outDir, { recursive: true });

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
      const safe = filePath.startsWith(publicDir) ? filePath : join(publicDir, 'index.html');
      const actual = existsSync(safe) ? safe : join(publicDir, 'index.html');
      const data = await readFile(actual);
      res.statusCode = 200;
      res.setHeader('content-type', contentType[extname(actual)] || 'application/octet-stream');
      res.end(data);
    } catch (err) {
      res.statusCode = 500; res.end(String(err));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, async close() { await new Promise((r, j) => server.close((e) => e ? j(e) : r())); } };
}

async function configureLocal(page, gameId, seats) {
  await page.evaluate(({ gameId, seats }) => {
    if (typeof window.setLocalSeats === 'function') window.setLocalSeats(seats);
    if (typeof window.startLocalForGame === 'function') window.startLocalForGame(gameId);
  }, { gameId, seats });
  await page.waitForSelector('#gameScreen.active');
  await page.waitForTimeout(800);
}

async function measure(page) {
  return await page.evaluate(() => {
    function rect(sel) {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        top: Math.round(r.top), left: Math.round(r.left),
        width: Math.round(r.width), height: Math.round(r.height),
        bottom: Math.round(r.bottom),
        alignItems: cs.alignItems, justifyContent: cs.justifyContent,
        marginLeft: cs.marginLeft, marginRight: cs.marginRight,
      };
    }
    return {
      viewport: { w: innerWidth, h: innerHeight },
      gameScreen: rect('#gameScreen.active'),
      topbar: rect('#gameScreen .game-topbar'),
      miniBoards: rect('#gameScreen .mini-boards-container'),
      topArea: rect('#topArea'),
      mainBoards: rect('#mainBoardsContainer'),
      playerBoard: rect('#mainBoardsContainer .player-board') || rect('#mainBoardsContainer .qwixx-table'),
      statusBar: rect('#gameScreen .status-bar'),
    };
  });
}

async function shoot(page, name) {
  const path = join(outDir, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function runGame(browser, baseUrl, gameId, label, viewport, isMobile) {
  const page = await browser.newPage({ viewport, isMobile, deviceScaleFactor: 2 });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('#menuScreen.active');
  await configureLocal(page, gameId, [
    { name: 'Eric', bot: false },
    { name: 'Bot',  bot: true, difficulty: 'easy' },
  ]);
  const m = await measure(page);
  const shot = await shoot(page, `${label}-${gameId}`);
  console.log(`\n=== ${label} ${gameId} ===  ${shot}`);
  console.log('  viewport:', m.viewport);
  for (const [k, v] of Object.entries(m)) {
    if (k === 'viewport') continue;
    if (!v) { console.log(`  ${k}: <missing>`); continue; }
    console.log(`  ${k}: top=${v.top} left=${v.left} w=${v.width} h=${v.height} bottom=${v.bottom}` +
      (v.alignItems ? ` align=${v.alignItems} justify=${v.justifyContent} ml=${v.marginLeft} mr=${v.marginRight}` : ''));
  }
  await page.close();
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const mobile = { width: 390, height: 844 };
    const desktop = { width: 1400, height: 950 };
    for (const game of ['skyjo', 'qwixx', 'flip7']) {
      await runGame(browser, server.url, game, 'mobile', mobile, true);
    }
    for (const game of ['skyjo', 'qwixx', 'flip7']) {
      await runGame(browser, server.url, game, 'desktop', desktop, false);
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => { console.error(e.stack || e); process.exit(1); });
