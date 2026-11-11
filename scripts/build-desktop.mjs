// Construit le serveur Astro autonome, le paquet de mesure et prépare les ressources Tauri.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tauri = path.join(root, 'src-tauri');
const appDir = path.join(tauri, 'resources', 'app');
const mesureSrc = path.join(root, 'mesure');
const mesureDir = path.join(tauri, 'resources', 'mesure');
const nodeDest = path.join(tauri, 'binaries', 'node-x86_64-pc-windows-msvc.exe');
const log = (m) => console.log(`[build-desktop] ${m}`);
const fail = (m) => { console.error(`[build-desktop] ERREUR : ${m}`); process.exit(1); };
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

// a. Build Astro
log('1/5 Compilation Astro (dépendances serveur embarquées)...');
const astroBin = path.join(root, 'node_modules', 'astro', 'bin', 'astro.mjs');
const build = spawnSync(process.execPath, [astroBin, 'build'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, ECOAUDIT_DESKTOP: '1' },
});
if (build.status !== 0) fail('astro build a échoué.');

// b. Ressources de l'interface
log('2/5 Préparation de src-tauri/resources/app ...');
fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });
fs.cpSync(path.join(root, 'dist', 'server'), path.join(appDir, 'server'), { recursive: true });
fs.cpSync(path.join(root, 'dist', 'client'), path.join(appDir, 'client'), { recursive: true });

// b1. Astro inscrit dans le manifeste des chemins absolus de la machine de build (dont le nom
// d'utilisateur Windows). On les remplace par un chemin neutre, de façon cohérente (les chemins
// relatifs serveur/client restent valides), avant le scan anti-fuite.
log('2a/5 Neutralisation des chemins absolus de la machine de build...');
{
  // Regex insensibles à la casse (Windows) : chaque séparateur du chemin racine devient une classe.
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = root.split(/[\\/]+/).filter(Boolean);
  const mk = (sep, prefix) => new RegExp(prefix + parts.map(esc).join(sep), 'gi');
  const rules = [
    [mk('(?:\\\\\\\\|\\\\|/)', 'file:///'), 'file:///C:/ecoaudit-build'],
    [mk('\\\\\\\\', ''), 'C:\\\\ecoaudit-build'],
    [mk('\\\\(?!\\\\)', ''), 'C:\\ecoaudit-build'],
    [mk('/', ''), 'C:/ecoaudit-build'],
  ];
  // Filet : tout préfixe de dossier utilisateur restant
  const userRe = /[A-Za-z]:(\\\\|\\|\/)Users(\\\\|\\|\/)[^\\/"'`\s:*?<>|]+/gi;
  const userRepl = (sep) => 'C:' + sep + 'ecoaudit-build';
  let safety = 0;
  let n = 0;
  for (const f of walk(appDir)) {
    if (!/\.(mjs|js|cjs|json|html|map)$/i.test(f)) continue;
    let s = fs.readFileSync(f, 'utf8');
    const before = s;
    for (const [re, rep] of rules) s = s.replace(re, () => rep);
    s = s.replace(userRe, (m, sep) => { safety++; return userRepl(sep); });
    if (s !== before) { fs.writeFileSync(f, s); n++; }
  }
  log(`  ${n} fichier(s) nettoyé(s).`);
  log(`  filet de sécurité (dossier utilisateur résiduel) : ${safety} remplacement(s).`);
}

// b2. Scan anti-fuite : l'app distribuée ne doit contenir aucune donnée personnelle
log('2b/5 Scan anti-fuite (.env, audits, chemins utilisateur)...');
{
  for (const bad of ['data', '.env', '.env.production']) {
    if (fs.existsSync(path.join(appDir, bad))) fail(`"${bad}" ne doit jamais être copié dans resources/app.`);
  }
  const userPathRe = /[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)/i;
  const leaks = [];
  for (const f of walk(appDir)) {
    if (userPathRe.test(fs.readFileSync(f).toString('latin1'))) {
      leaks.push(`${path.relative(appDir, f)} -> chemin utilisateur Windows (X:\\Users\\)`);
    }
  }
  if (leaks.length) fail('fuite potentielle de données personnelles :\n  ' + leaks.join('\n  '));
  log('  OK : aucun chemin utilisateur ni fichier .env trouvé.');
}

// c. Paquet de mesure autonome : scripts de mesure/ + node_modules de production (versions du lock)
log('3/5 Préparation de src-tauri/resources/mesure ...');
{
  fs.rmSync(mesureDir, { recursive: true, force: true });
  fs.mkdirSync(mesureDir, { recursive: true });
  for (const e of fs.readdirSync(mesureSrc, { withFileTypes: true })) {
    if (e.isFile() && /\.(mjs|js|cjs|json)$/i.test(e.name) && e.name !== 'package-lock.json') {
      fs.copyFileSync(path.join(mesureSrc, e.name), path.join(mesureDir, e.name));
    }
  }
  // Dépendances de production du workspace « mesure », telles que résolues par package-lock.json
  // (aucun téléchargement : ce sont les dossiers déjà installés à la racine).
  const npmCli = process.env.npm_execpath;
  const ls = npmCli
    ? spawnSync(process.execPath, [npmCli, 'ls', '--omit=dev', '--all', '--parseable', '--workspace', 'mesure'],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    : spawnSync('npm', ['ls', '--omit=dev', '--all', '--parseable', '--workspace', 'mesure'],
      { cwd: root, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  const rootModules = path.join(root, 'node_modules') + path.sep;
  const deps = new Set();
  for (const line of (ls.stdout || '').split(/\r?\n/)) {
    const p = line.trim();
    if (p.toLowerCase().startsWith(rootModules.toLowerCase())) deps.add(p);
  }
  if (!deps.size) fail('aucune dépendance de mesure trouvée (npm install a-t-il été lancé ?).');
  for (const p of deps) {
    const rel = p.slice(rootModules.length);
    // Le workspace « mesure » lui-même (lien) est ignoré : ses fichiers sont déjà copiés.
    if (rel === 'mesure' || !fs.existsSync(p)) continue;
    fs.cpSync(p, path.join(mesureDir, 'node_modules', rel), { recursive: true, dereference: true });
  }
  for (const need of ['lighthouse', 'puppeteer-core']) {
    if (!fs.existsSync(path.join(mesureDir, 'node_modules', need, 'package.json'))) {
      fail(`« ${need} » absent des dépendances de production de mesure.`);
    }
  }
  // Scan : les scripts de mesure eux-mêmes ne doivent contenir aucun chemin utilisateur.
  const userPathRe = /[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)/i;
  for (const e of fs.readdirSync(mesureDir, { withFileTypes: true })) {
    if (e.isFile() && userPathRe.test(fs.readFileSync(path.join(mesureDir, e.name), 'latin1'))) {
      fail(`mesure/${e.name} contient un chemin utilisateur Windows.`);
    }
  }
  log(`  ${deps.size} paquet(s) de production copié(s).`);
}

// d. Sidecar node
log('4/5 Copie de node.exe (sidecar)...');
fs.mkdirSync(path.dirname(nodeDest), { recursive: true });
const same = fs.existsSync(nodeDest) && fs.statSync(nodeDest).size === fs.statSync(process.execPath).size
  && fs.readFileSync(nodeDest).equals(fs.readFileSync(process.execPath));
if (!same) fs.copyFileSync(process.execPath, nodeDest);

// e. Auto-test hors du projet (sans node_modules)
log('5/5 Auto-test autonome...');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecoaudit-selftest-'));
const tmpApp = path.join(tmp, 'app');
const tmpMesure = path.join(tmp, 'mesure');
const tmpCwd = path.join(tmp, 'cwd');
fs.cpSync(appDir, tmpApp, { recursive: true });
fs.cpSync(mesureDir, tmpMesure, { recursive: true });
fs.mkdirSync(tmpCwd);
const PORT = 4799;
let output = '';
const child = spawn(nodeDest, [path.join(tmpApp, 'server', 'entry.mjs')], {
  cwd: tmpCwd, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
child.stdout.on('data', (d) => (output += d));
child.stderr.on('data', (d) => (output += d));
let exited = null;
child.on('exit', (c) => (exited = c));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(p) {
  try { return (await fetch(`http://127.0.0.1:${PORT}${p}`)).status; } catch { return 0; }
}
let ok = true;
try {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && exited === null && (await get('/')) !== 200) await sleep(300);
  for (const p of ['/', '/mes-audits']) {
    const s = await get(p);
    log(`  GET ${p} -> ${s}`);
    if (s !== 200) ok = false;
  }
  if (exited !== null) { ok = false; log(`  le serveur s'est arrêté (code ${exited})`); }

  // Le processus de mesure démarre depuis les ressources, sans node_modules du projet.
  const mesure = spawnSync(nodeDest, [path.join(tmpMesure, 'processus.mjs'), '--autotest'], {
    cwd: tmpCwd, encoding: 'utf8', timeout: 60000, windowsHide: true,
  });
  const reponse = (mesure.stdout || '').trim();
  log(`  mesure --autotest -> ${reponse || '(vide)'} (code ${mesure.status})`);
  if (mesure.status !== 0 || reponse !== 'ok') { ok = false; output += `\n${mesure.stderr || ''}`; }
} finally {
  if (exited === null) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/F', '/T'], { stdio: 'ignore' });
    child.kill();
  }
  await sleep(500);
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
}
if (!ok) { console.error(output); fail('auto-test échoué.'); }
log('Auto-test réussi : le serveur et la mesure sont autonomes. Terminé.');
