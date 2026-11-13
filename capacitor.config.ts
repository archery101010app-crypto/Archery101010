import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.archery101010.app',
  appName: 'Archery 101010',
  webDir: 'out',
  server: {
    androidScheme: 'https',
    allowNavigation: [
      'archery101010-c0bb4.web.app',
      'archery101010-c0bb4.firebaseapp.com',
      'accounts.google.com',
      '*.spotify.com'
    ]
  },
  backgroundColor: '#050505',
  plugins: {
    SplashScreen: {
      launchShowDuration: 1800,
      launchAutoHide: true,
      backgroundColor: '#050505',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#050505',
      overlaysWebView: false
    }
  }
};

export default config;
