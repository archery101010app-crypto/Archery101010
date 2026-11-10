importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

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
    const notificationTitle =
      (payload && payload.notification && payload.notification.title) || 'ARCHERY 101010';
    const notificationOptions = {
      body:
        (payload && payload.notification && payload.notification.body) ||
        'Tienes un nuevo reto o actualización.',
      icon:
        (payload && payload.notification && payload.notification.icon) || '/images/logo_final.png',
      badge: '/favicon.ico',
      data: payload ? payload.data : undefined
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
  });
} catch (err) {
  console.warn('[firebase-messaging-sw.js] Initialization warning:', err);
}
