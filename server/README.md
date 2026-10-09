# Step4Step Heim-Sync-Server

Läuft auf dem Mac mini, speichert alle Aufgaben zentral in
`~/Library/Application Support/S4S-Sync/data/store.json` (tägliche Snapshots, App-Backups auf den Stick BrainUpdate).

- Einrichten / aktualisieren: `bash server/install.sh` (Zugangscode, CA und Daten bleiben erhalten; das Server-Zertifikat wird neu erzeugt)
- Autostart: LaunchAgent `de.step4step.heimsync`
- Heim-WLAN: `https://<Mac>.local:8743` mit eigener Heim-CA. Die CA ist per Name-Constraint auf .local und private IPs beschränkt –
  Tailscale-Adressen dürfen deshalb NICHT ins Server-Zertifikat (sonst ist das ganze Zertifikat ungültig).
- Unterwegs: `tailscale serve --bg https+insecure://localhost:8743` → erreichbar unter `https://<mac>.<tailnet>.ts.net`
  mit gültigem Tailscale-Zertifikat (kein Zertifikat auf dem iPhone nötig). In der App als Adresse nur den ts.net-Namen eintragen.
- Nur Python-Standardbibliothek, keine Abhängigkeiten.

## Erinnerungen / Calendar 366 (`server/reminders/`)
- Gleicht die Erinnerungsliste **„Step4Step“** mit den Aufgaben ab (alle 2 Min., LaunchAgent `de.step4step.erinnerungen`).
- Abgeglichen: Titel, Priorität, erledigt. Neue Einträge auf beiden Seiten werden angelegt. Gelöscht wird nie automatisch.
- Einrichten: `bash server/reminders/install.sh` (braucht Swift: `xcode-select --install`). Protokoll: `reminders-bridge.log`.
