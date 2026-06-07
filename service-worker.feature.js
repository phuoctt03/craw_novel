self.addEventListener("install", event => {
  event.waitUntil(
    caches.open("novel-feature-app-cache-v2").then(cache => {
      return cache.addAll([
        "./",
        "./feature.html",
        "./manifest.feature.json",
        "./novel.png",
        "./novel.css",
        "./pdf.css",
        "./novel.js",
        "./pdf.js"
      ]);
    })
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
