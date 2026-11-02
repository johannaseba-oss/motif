// Trägt nach "cap add ios" den Kamera-Hinweis in die Info.plist ein.
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'ios/App/App/Info.plist';
let plist = readFileSync(file, 'utf8');
if (!plist.includes('NSCameraUsageDescription')) {
  plist = plist.replace('</dict>\n</plist>', `\t<key>NSCameraUsageDescription</key>
\t<string>MOTIF braucht die Kamera, um deine Fotos als Briefmarken aufzunehmen.</string>
</dict>
</plist>`);
  writeFileSync(file, plist);
}
