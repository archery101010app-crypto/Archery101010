importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

try {
  const urlParams = new URLSearchParams(self.location ? self.location.search : '');
  const firebaseConfig = {
    apiKey: urlParams.get('apiKey') || 'AIzaSyDFhnSTI6WbxHB8duYukpEBk9wKjxpduTE',
    authDomain: urlParams.get('authDomain') || 'archery101010-c0bb4.firebaseapp.com',
    projectId: urlParams.get('projectId') || 'archery101010-c0bb4',
    storageBucket: urlParams.get('storageBucket') || 'archery101010-c0bb4.firebasestorage.app',
    messagingSenderId: urlParams.get('messagingSenderId') || '757910399585',
    appId: urlParams.get('appId') || '1:757910399585:web:3cbcf50a21971cdc5b5820'
  };

  if (!firebase.apps || firebase.apps.length === 0) {
    firebase.initializeApp(firebaseConfig);
  }

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const rawNotif = (payload && payload.notification) || {};
    const rawData = (payload && payload.data) || {};

    const notificationTitle = rawNotif.title || rawData.title || 'ARCHERY 101010';
    const notificationOptions = {
      body: rawNotif.body || rawData.body || 'Tienes un nuevo reto o actualización en ARCHERY 101010.',
      icon: rawNotif.icon || rawData.icon || '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      vibrate: [180, 90, 180],
      tag: rawData.tag || rawData.type || 'archery-101010-push',
      renotify: true,
      data: {
        ...rawData,
        url: rawData.url || '/'
      }
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
  });
} catch (err) {
  console.warn('[firebase-messaging-sw.js] Initialization warning:', err);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawTarget = (event.notification && event.notification.data && event.notification.data.url) || '/';
  const targetUrl = new URL(rawTarget, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (let i = 0; i < windowClients.length; i++) {
          const client = windowClients[i];
          if (client.url && client.url.startsWith(self.location.origin) && 'focus' in client) {
            if (rawTarget !== '/' && 'navigate' in client) {
              return client.navigate(targetUrl).then((navClient) => (navClient ? navClient.focus() : client.focus()));
            }
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
