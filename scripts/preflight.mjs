#!/usr/bin/env node
/**
 * preflight — confere o projeto ANTES de dar push / deploy. Sem dependências.
 *
 * Uso:
 *   node scripts/preflight.mjs                 # roda tudo
 *   node scripts/preflight.mjs --no-fetch      # não fala com o servidor git
 *   node scripts/preflight.mjs --skip build    # pula um passo (repita para vários)
 *
 * Configuração: preflight.config.json na raiz do projeto (todos os campos opcionais).
 * Sai com código 1 se alguma checagem BLOQUEIA. Avisos (⚠️) não bloqueiam.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const noFetch = args.includes('--no-fetch');
const skip = new Set();
args.forEach((a, i) => { if (a === '--skip' && args[i + 1]) skip.add(args[i + 1]); });

const DEFAULTS = {
  baseBranch: 'main',
  allowedAuthor: '',
  steps: ['typecheck', 'lint', 'test', 'build'],
  extra: [],
  secretScan: true,
  allowDeletedFiles: false,
};
let cfg = { ...DEFAULTS };
if (existsSync('preflight.config.json')) {
  try { cfg = { ...DEFAULTS, ...JSON.parse(readFileSync('preflight.config.json', 'utf8')) }; }
  catch (e) { console.log(`🔴 preflight.config.json inválido: ${e.message}`); process.exit(1); }
}

let bloqueios = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const erro = (m) => { console.log(`  🔴 ${m}`); bloqueios += 1; };
const aviso = (m) => console.log(`  ⚠️  ${m}`);
const titulo = (m) => console.log(`\n▶ ${m}`);

const git = (a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
const gitTry = (a) => spawnSync('git', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// ── 1. Git ─────────────────────────────────────────────────────────────────
titulo('Git');
if (gitTry(['rev-parse', '--git-dir']).status !== 0) {
  erro('não estou dentro de um repositório git.');
  process.exit(1);
}
const branch = git(['branch', '--show-current']) || '(sem branch)';
console.log(`  branch atual: ${branch}`);

if (!noFetch) {
  const f = gitTry(['fetch', '-q', 'origin', cfg.baseBranch]);
  if (f.status === 0) ok(`fetch origin/${cfg.baseBranch}`);
  else aviso(`fetch falhou (${(f.stderr || '').trim().split('\n')[0]}) — sigo com o que há local`);
}

const sujo = git(['status', '--porcelain']).split('\n').filter(Boolean);
if (sujo.length) erro(`árvore suja: ${sujo.length} arquivo(s) sem commit (ex.: ${sujo[0].trim()})`);
else ok('árvore limpa');

if (cfg.allowedAuthor) {
  const email = gitTry(['config', 'user.email']).stdout.trim();
  if (email === cfg.allowedAuthor) ok(`autor = ${email}`);
  else erro(`git user.email é "${email || '(vazio)'}", esperado ${cfg.allowedAuthor}. Corrija: git config user.email ${cfg.allowedAuthor}`);
}

const baseRef = ['origin/' + cfg.baseBranch, cfg.baseBranch].find((r) => gitTry(['rev-parse', '--verify', '--quiet', r]).status === 0);
if (!baseRef) {
  aviso(`branch base "${cfg.baseBranch}" não encontrada — pulei as comparações com a base`);
} else {
  const atras = Number(git(['rev-list', '--count', `HEAD..${baseRef}`]));
  if (atras > 0) erro(`a base ${baseRef} tem ${atras} commit(s) que esta branch não tem. Traga-os (merge/rebase) e rode de novo`);
  else ok(`branch contém ${baseRef}`);

  const apagados = git(['diff', '--diff-filter=D', '--name-only', `${baseRef}...HEAD`]).split('\n').filter(Boolean);
  if (apagados.length && !cfg.allowDeletedFiles) {
    erro(`${apagados.length} arquivo(s) apagado(s) em relação à base:\n       ${apagados.slice(0, 15).join('\n       ')}`);
  } else if (apagados.length) aviso(`${apagados.length} arquivo(s) apagado(s) (permitido pela config)`);
  else ok('nenhum arquivo apagado em relação à base');

  if (cfg.secretScan) {
    const diff = git(['diff', '-U0', `${baseRef}...HEAD`]);
    const padroes = [
      [/AKIA[0-9A-Z]{16}/, 'chave AWS'],
      [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'chave privada'],
      [/sk-[A-Za-z0-9]{32,}/, 'chave estilo sk-…'],
      [/ghp_[A-Za-z0-9]{30,}/, 'token do GitHub'],
      [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, 'JWT/token'],
      [/(secret|password|senha|api[_-]?key|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i, 'segredo no código'],
    ];
    const achados = [];
    for (const linha of diff.split('\n')) {
      if (!linha.startsWith('+') || linha.startsWith('+++')) continue;
      for (const [re, nome] of padroes) if (re.test(linha)) achados.push(`${nome}: ${linha.slice(1, 80).trim()}…`);
    }
    const envTrack = git(['diff', '--name-only', `${baseRef}...HEAD`]).split('\n').filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !/example|sample|template/.test(f));
    if (envTrack.length) achados.push(`arquivo .env no diff: ${envTrack.join(', ')}`);
    if (achados.length) erro(`possível segredo no que vai subir:\n       ${achados.slice(0, 8).join('\n       ')}`);
    else ok('nenhum segredo óbvio no diff');
  }
}

// ── 2. Passos do projeto (package.json) ────────────────────────────────────
titulo('Projeto');
const pm = existsSync('pnpm-lock.yaml') ? 'pnpm' : existsSync('yarn.lock') ? 'yarn' : (existsSync('bun.lockb') || existsSync('bun.lock')) ? 'bun' : 'npm';
let scripts = {};
if (existsSync('package.json')) {
  try { scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts || {}; } catch { aviso('package.json ilegível'); }
} else aviso('sem package.json — só rodo as checagens de git e os comandos "extra"');

const rodar = (rotulo, cmd, cmdArgs) => {
  const t0 = Date.now();
  console.log(`  … ${rotulo}`);
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status === 0) ok(`${rotulo} (${s}s)`);
  else erro(`${rotulo} falhou (código ${r.status}) — role acima para ver o erro`);
};

for (const passo of cfg.steps) {
  if (skip.has(passo)) { aviso(`${passo}: pulado por --skip`); continue; }
  if (scripts[passo]) rodar(`${pm} run ${passo}`, pm, ['run', passo]);
  else if (passo === 'typecheck' && existsSync('tsconfig.json')) rodar('tsc --noEmit', 'npx', ['tsc', '--noEmit']);
  else aviso(`${passo}: não existe no package.json — pulado`);
}

for (const cmd of cfg.extra) {
  if (skip.has(cmd)) { aviso(`${cmd}: pulado por --skip`); continue; }
  rodar(cmd, cmd, []);
}

// ── Resultado ──────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
if (bloqueios) {
  console.log(`🔴 ${bloqueios} problema(s) bloqueando. NÃO suba até resolver.`);
  console.log('   Lembrete: o build local não prova o deploy (variáveis de ambiente e autor do commit só falham no servidor).');
  process.exit(1);
}
console.log('✅ Tudo verde. Lembrete: isso não prova o deploy — confira o preview/deploy depois do push.');
