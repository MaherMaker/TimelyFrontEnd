import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'me.mahermaker.timely',
  appName: 'timelyApp',
  webDir: 'www',
  plugins: {
    AlarmManager: {
      // You can add plugin-specific configurations here if needed
    }
  },
  server: {
    cleartext: true, // Allow HTTP connections
    androidScheme: 'http' // Force HTTP scheme for Android
  }
};

export default config;
