import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export function tick(style = 'light') {
  if (Capacitor.isNativePlatform()) {
    Haptics.impact({ style: style === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => {});
  } else {
    navigator.vibrate?.(style === 'medium' ? 18 : 8);
  }
}
