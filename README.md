# MOTIF

Kamera-App: Das Foto wird in der Briefmarken-Form aufgenommen, ausgeschnitten und in ein Album geklebt.

## Starten

```bash
npm install
npm run dev
```

Läuft auf http://localhost:5197. Testparameter im Dev-Server: `?fakecam` (Testbild statt Kamera), `?seed=40` (Testmarken bei leerem Album).

## Auf dem iPhone ausprobieren (ohne Mac)

iOS gibt die Kamera nur über HTTPS frei, deshalb:

```bash
npm run dev:phone
```

Dann auf dem iPhone im selben WLAN `https://<PC-IP>:5197` in Safari öffnen und die Zertifikatswarnung bestätigen.

## Als echte iOS-App bauen (Mac mit Xcode nötig)

Das Xcode-Projekt liegt in `ios/`.

```bash
npm run ios:sync
```

```bash
npm run ios:open
```

## Aufbau

| Datei | Inhalt |
|---|---|
| `src/camera.js` | Sucher in Markenform, Aufnahme, Kamerawechsel |
| `src/stamp.js` | Zuschnitt auf die Form, PNG mit Transparenz (900 px breit) + Vorschau (320 px) |
| `src/stamp-shape.js` | Umriss, automatisch aus `assets-input/stamp-shape.webp` (`npm run assets:shape`) |
| `src/album.js` | Buch, Blättern, Verschieben |
| `src/store.js` | Lokale Speicherung in IndexedDB |
| `src/main.js` | Profil, große Ansicht, Start |

Icons neu erzeugen: `node tools/make_icons.mjs`. Das 1024-px-Icon für Xcode liegt danach in `assets-input/generated/`.
