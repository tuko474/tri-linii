import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.trilinii.game', // поменяй на свой домен до первой публикации — потом сменить нельзя
  appName: 'Три Линии',
  webDir: 'dist',
  backgroundColor: '#17142a',
  android: { allowMixedContent: false },
  ios: { contentInset: 'never' },
};

export default config;
