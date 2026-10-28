import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.archery101010.app',
  appName: 'Archery 101010',
  webDir: 'out',
  server: {
    androidScheme: 'https',
    allowNavigation: [
      '*.firebaseapp.com',
      '*.web.app',
      '*.google.com',
      'accounts.google.com',
      '*.googleusercontent.com',
      '*.gstatic.com',
      '*.facebook.com',
      '*.fbcdn.net'
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
