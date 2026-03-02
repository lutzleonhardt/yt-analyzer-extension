# YT Analyzer – Chrome Extension

Analysiert YouTube-Videos auf Hype, Substanz und Manipulation. Zeigt Scores direkt auf der YouTube-Startseite als Badges an den Thumbnails.

## Installation

1. **Chrome öffnen** und `chrome://extensions/` in die Adressleiste eingeben
2. **Developer mode** oben rechts aktivieren
3. **"Load unpacked"** klicken und den `yt-analyzer-extension/` Ordner auswählen
4. Die Extension erscheint in der Chrome-Toolbar

## Einrichtung

1. Klicke auf das Extension-Icon in der Toolbar oder gehe zu den **Einstellungen** (Zahnrad-Icon)
2. Wähle deinen LLM-Provider:
   - **OpenAI**: Trage deinen API-Key ein (beginnt mit `sk-...`)
   - **Anthropic**: Trage deinen API-Key ein (beginnt mit `sk-ant-...`)
3. Wähle das gewünschte Modell
4. **Speichern** klicken

## Nutzung

1. **YouTube-Startseite** öffnen (youtube.com)
2. Unten rechts erscheint der **"Analysieren"-Button** (Auge-Icon)
3. **Klick** → die Extension analysiert alle sichtbaren Videos
4. Jedes Video erhält ein **Score-Badge** auf dem Thumbnail:
   - 🟢 **Grün (70-100)**: Hohe Substanz — "Substanz"
   - 🟡 **Gelb (40-69)**: Gemischte Qualität — "Gemischt"
   - 🔴 **Rot (0-39)**: Clickbait-verdächtig — "Clickbait"
5. **Klick auf ein Badge** öffnet das Side Panel mit der Detail-Analyse

## Side Panel

Das Side Panel (rechte Seite) zeigt:
- Alle analysierten Videos als Karten
- Sortierbar nach: Gesamt-Score, Hype, Substanz, Manipulation
- Klick auf eine Karte zeigt:
  - 4 Score-Balken (Hype, Substanz, Manipulation, Gesamt)
  - Erklärungstext
  - Red Flags / Green Flags als Pill-Badges
  - Metadaten (Transkript-Status, verwendetes Modell, Zeitstempel)

## Bewertungsdimensionen

| Dimension | 0 = | 100 = |
|---|---|---|
| **Hype-Score** | Sachlich, nüchtern | Maximaler Hype, FOMO, Superlative |
| **Substanz-Score** | Reine Meinung ohne Belege | Faktenbasiert, differenziert, Quellen |
| **Manipulations-Score** | Keine Manipulation | Hochgradig manipulativ |
| **Gesamt-Score** | Niedrige Qualität | Hohe Inhaltsqualität |

**Gesamt-Formel**: `Substanz - (Hype × 0.3) - (Manipulation × 0.4)`, geclampt auf 0-100.

## Sicherheit

- API-Keys werden in `chrome.storage.local` gespeichert (nur diese Extension hat Zugriff)
- Bei OpenAI/Anthropic gehen Calls direkt vom Service Worker an die API — kein Drittanbieter-Server
- Transkripte werden direkt von YouTube geholt (kein Proxy nötig, da die Extension `host_permissions` hat)

## Technische Details

- **Manifest V3** Chrome Extension
- **Content Script** mit MutationObserver für YouTube's SPA-Navigation
- **Service Worker** für API-Calls und Caching
- **Side Panel API** (Chrome 114+) für die Detail-Ansicht
- Unterstützte URL-Formate: `watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`

## Voraussetzungen

- Chrome 114+ (für Side Panel API)
- OpenAI oder Anthropic API-Key
