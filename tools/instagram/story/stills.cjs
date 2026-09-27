// Draws chosen moments of the Story as stills, to check the design without a full render.
//   node stills.cjs story.html out-dir t1 t2 ...
const path = require('path');
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')); }
const [, , html, dir, ...times] = process.argv;
(async () => {
  const b = await pw.chromium.launch();
  const size = JSON.parse(require('fs').readFileSync(html, 'utf8').match(/window\.STORY=(\{.*?\});<\/script>/s)[1]);
  const p = await b.newPage({ viewport: { width: size.W, height: size.H } });
  const problems = [];
  p.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  p.on('pageerror', (e) => problems.push(e.message));
  p.on('requestfailed', (r) => problems.push('could not load ' + r.url()));
  await p.goto('file://' + path.resolve(html), { waitUntil: 'load' });
  console.log(JSON.stringify(await p.evaluate(() => window.ready())));
  for (const t of times) {
    await p.evaluate((x) => window.render(x), Number(t));
    await p.screenshot({ path: path.join(dir, `t${Number(t).toFixed(2)}.jpg`), type: 'jpeg', quality: 85 });
  }
  if (problems.length) console.error('PROBLEMS', problems.join('\n'));
  await b.close();
})();
