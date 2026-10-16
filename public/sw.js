const CACHE_PREFIX = "al-saree-shell-"
const CACHE = `${CACHE_PREFIX}v2`
const APP_SHELL = ["/", "/icon.svg", "/icon-maskable.svg", "/manifest.webmanifest"]

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)))
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== "GET" || url.origin !== self.location.origin) return

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => {
        const shell = await caches.match("/")
        return shell || Response.error()
      }),
    )
    return
  }

  const isVersionedAsset = url.pathname.startsWith("/assets/")
  const isAppAsset = ["/icon.svg", "/icon-maskable.svg", "/manifest.webmanifest"].includes(url.pathname)
  if (!isVersionedAsset && !isAppAsset) return

  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const cached = await cache.match(req)
    if (cached) return cached

    const response = await fetch(req)
    if (response.ok) await cache.put(req, response.clone())
    return response
  })())
})
