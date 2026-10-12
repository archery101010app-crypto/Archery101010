import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.archery101010.app',
  appName: 'Archery 101010',
  webDir: 'out',
  server: {
    androidScheme: 'https'
  },
  backgroundColor: '#050505',
  plugins: {
    // Custom native plugin configs if needed
  }
};

export default config;
