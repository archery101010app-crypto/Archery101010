importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

// Parse the query parameters to extract the real messagingSenderId dynamically
const urlParams = new URLSearchParams(location.search);
const messagingSenderId = urlParams.get('messagingSenderId') || '1234567890';

// Initialize the Firebase app in the service worker
firebase.initializeApp({
  messagingSenderId: messagingSenderId
});

const messaging = firebase.messaging();

// Background push notification receiver
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Background message received:', payload);

  const notificationTitle = payload.notification?.title || 'Archery 101010 ⚔️';
  const notificationOptions = {
    body: payload.notification?.body || 'Tienes un nuevo reto o actualización.',
    icon: payload.notification?.icon || '/images/logo_final.png',
    badge: '/favicon.ico',
    data: payload.data
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
