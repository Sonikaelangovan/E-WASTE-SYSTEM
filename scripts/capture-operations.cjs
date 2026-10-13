/* Render verified command output as terminal-style evidence images.
 * Requires Playwright via ECOTRACE_PLAYWRIGHT_MODULE and local Edge.
 * This does not fabricate command results or include private environment values.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.ECOTRACE_PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'screenshots');
fs.mkdirSync(out, { recursive: true });
const docker = 'C:\\Users\\thira\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker.exe';
const wsl = 'wsl.exe';

function run(program, args) {
  return execFileSync(program, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }).trim();
}
function escape(text) {
  return String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
async function capture(browser, filename, title, blocks) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 420 }, deviceScaleFactor: 1 });
  const body = blocks.map(({ command, output }) => `<section><div class="prompt">PS C:\\Users\\thira\\Flight_Management\\E-Waste-System&gt; <strong>${escape(command)}</strong></div><pre>${escape(output)}</pre></section>`).join('');
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;background:#111827;color:#e5e7eb;font-family:Consolas,'Cascadia Mono',monospace;font-size:17px;line-height:1.42}.window{margin:24px;border:1px solid #334155;border-radius:12px;overflow:hidden;box-shadow:0 18px 50px #0008}.bar{background:#1f2937;padding:13px 18px;border-bottom:1px solid #334155;display:flex;align-items:center;gap:9px}.dot{width:11px;height:11px;border-radius:50%;background:#64748b}.bar b{margin-left:12px;color:#f8fafc;font-size:16px;font-weight:600}.body{padding:20px 24px 26px}section{margin-bottom:22px}.prompt{color:#93c5fd;white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:9px}.prompt strong{color:#f8fafc;font-weight:500}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:#d1fae5}.stamp{color:#94a3b8;font-size:13px;border-top:1px solid #334155;padding-top:12px}
  </style></head><body><div class="window"><div class="bar"><i class="dot"></i><i class="dot"></i><i class="dot"></i><b>${escape(title)}</b></div><div class="body">${body}<div class="stamp">Captured from successful local commands · ${escape(new Date().toLocaleString('en-IN'))}</div></div></div></body></html>`);
  await page.screenshot({ path: path.join(out, filename), fullPage: true });
  await page.close();
  console.log(`Captured ${filename}`);
}

(async () => {
  const browser = await chromium.launch({headless:true,executablePath:process.env.ECOTRACE_EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'});
  try {
    await capture(browser, '10-docker-containers-and-image.png', 'Docker · containers and image', [
      {command:'docker compose ps',output:run(docker,['compose','ps'])},
      {command:'docker image ls e-waste-system-app',output:run(docker,['image','ls','e-waste-system-app'])}
    ]);
    await capture(browser, '11-docker-volume-and-health.png', 'Docker · persistent volume and health', [
      {command:'docker volume ls --filter name=e-waste-system',output:run(docker,['volume','ls','--filter','name=e-waste-system'])},
      {command:'curl.exe http://localhost:8092/api/health',output:run('curl.exe',['-fsS','http://localhost:8092/api/health'])}
    ]);
    await capture(browser, '12-ansible-idempotence.png', 'Ansible · deployment reconciliation', [
      {command:'wsl ansible-playbook -i ansible/inventory ansible/playbook.yml',output:run(wsl,['-d','Ubuntu','--','bash','-lc','cd /mnt/c/Users/thira/Flight_Management/E-Waste-System && ansible-playbook -i ansible/inventory ansible/playbook.yml'])}
    ]);
    await capture(browser, '13-automated-tests.png', 'Node.js · automated API tests', [
      {command:'npm test',output:run('cmd.exe',['/d','/s','/c','npm test'])}
    ]);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
