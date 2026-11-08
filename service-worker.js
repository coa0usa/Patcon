/* PATCON - Service Worker (modo offline)
 *
 * Ao alterar qualquer arquivo do app, aumente VERSAO (ex.: 'patcon-v2').
 * Isso faz os usuários receberem o aviso "Nova versão disponível".
 *
 * Estratégias:
 *  - Páginas HTML ........ rede primeiro (pega atualizações); sem rede, usa o cache.
 *  - CDN com versão fixa .. cache primeiro (o arquivo daquela versão nunca muda).
 *  - Fontes e demais ...... usa o cache na hora e atualiza em segundo plano.
 *
 * Os dados de produção NÃO passam por aqui: ficam no IndexedDB do navegador,
 * que já funciona offline.
 */
const VERSAO = 'patcon-v2';
const CACHE_APP = `${VERSAO}-app`;
const CACHE_EXTERNO = `${VERSAO}-externo`;
const PAGINA_PRINCIPAL = './index.html';

const ARQUIVOS_APP = [
  './',
  PAGINA_PRINCIPAL,
  './Produção_hora_a_hora.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

const ARQUIVOS_EXTERNOS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
];

const TEMPO_LIMITE_REDE_MS = 4000;

// ---------- Instalação: guarda os arquivos essenciais ----------
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const app = await caches.open(CACHE_APP);
    const ext = await caches.open(CACHE_EXTERNO);
    // Um por um: se um arquivo opcional faltar, os outros continuam sendo salvos
    const resultados = await Promise.allSettled([
      ...ARQUIVOS_APP.map(url => app.add(new Request(url, { cache: 'reload' }))),
      ...ARQUIVOS_EXTERNOS.map(url => ext.add(new Request(url, { mode: 'cors' })))
    ]);
    // O CSS do Google Fonts aponta para arquivos .woff2: guarda esses também
    try {
      const cssFontes = await ext.match(ARQUIVOS_EXTERNOS.find(u => u.includes('fonts.googleapis.com')));
      if (cssFontes) {
        const urls = [...(await cssFontes.clone().text()).matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1]);
        await Promise.allSettled([...new Set(urls)].map(u => ext.add(new Request(u, { mode: 'cors' }))));
      }
    } catch (e) { console.warn('[SW] Fontes não foram para o cache:', e); }

    const falhas = resultados.filter(r => r.status === 'rejected');
    if (falhas.length) console.warn(`[SW] ${falhas.length} arquivo(s) não foram para o cache:`, falhas.map(f => f.reason));
    // A página principal é obrigatória: sem ela, cancela a instalação
    if (!(await app.match(PAGINA_PRINCIPAL))) throw new Error('[SW] Página principal não foi para o cache.');
  })());
});

// ---------- Ativação: apaga caches de versões antigas ----------
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter(n => n.startsWith('patcon-') && !n.startsWith(VERSAO + '-')).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// A página pede para ativar a nova versão quando o usuário clica em "Atualizar"
self.addEventListener('message', event => {
  if (event.data && event.data.tipo === 'ATIVAR_NOVA_VERSAO') self.skipWaiting();
});

// ---------- Requisições ----------
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  const mesmoSite = url.origin === self.location.origin;
  const ehPagina = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  if (mesmoSite && ehPagina) {
    event.respondWith(redePrimeiro(event, req));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cachePrimeiro(req, CACHE_EXTERNO));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheEAtualiza(event, req, CACHE_EXTERNO));
  } else if (mesmoSite) {
    event.respondWith(cacheEAtualiza(event, req, CACHE_APP));
  }
  // Demais domínios: segue direto para a rede, sem cache
});

async function redePrimeiro(event, req) {
  const cache = await caches.open(CACHE_APP);
  try {
    const resp = await comTempoLimite(fetch(req), TEMPO_LIMITE_REDE_MS);
    if (resp && resp.ok) event.waitUntil(cache.put(req, resp.clone()));
    return resp;
  } catch (e) {
    return (await cache.match(req, { ignoreSearch: true }))
      || (await cache.match(PAGINA_PRINCIPAL))
      || new Response('<h1>Sem conexão</h1><p>Abra o app uma vez com internet para usá-lo offline.</p>',
           { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function cachePrimeiro(req, nomeCache) {
  const cache = await caches.open(nomeCache);
  const salvo = await cache.match(req);
  if (salvo) return salvo;
  const resp = await fetch(req);
  if (resp && (resp.ok || resp.type === 'opaque')) cache.put(req, resp.clone());
  return resp;
}

async function cacheEAtualiza(event, req, nomeCache) {
  const cache = await caches.open(nomeCache);
  const salvo = await cache.match(req, { ignoreSearch: req.url.startsWith(self.location.origin) });
  const daRede = fetch(req).then(resp => {
    if (resp && (resp.ok || resp.type === 'opaque')) cache.put(req, resp.clone());
    return resp;
  }).catch(() => null);
  if (salvo) { event.waitUntil(daRede); return salvo; }
  return (await daRede) || new Response('', { status: 504, statusText: 'Offline' });
}

function comTempoLimite(promessa, ms) {
  return new Promise((ok, erro) => {
    const t = setTimeout(() => erro(new Error('timeout')), ms);
    promessa.then(r => { clearTimeout(t); ok(r); }, e => { clearTimeout(t); erro(e); });
  });
}
