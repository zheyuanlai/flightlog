const CACHE_NAME = 'flightlog-v21'
const APP_SHELL = [
  './',
  './index.html',
  './app-icon.svg',
  './maskable-icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './data/airports.generated.json',
  './samples/sample_flights.csv',
  './samples/sample_flights.json',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => undefined),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch {
    return await cache.match(request)
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  const fetched = fetch(request)
    .then((response) => {
      if (response.ok) void cache.put(request, response.clone())
      return response
    })
    .catch(() => undefined)
  return cached ?? await fetched ?? Response.error()
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.includes('/flight-status')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request).then((response) => response ?? caches.match('./index.html')))
    return
  }

  if (url.pathname.endsWith('/data/airports.generated.json')) {
    event.respondWith(networkFirst(request))
    return
  }

  event.respondWith(staleWhileRevalidate(request))
})
