# Step4Step Heim-Sync-Server

Läuft auf dem Mac mini, speichert alle Aufgaben zentral in
`~/Library/Application Support/S4S-Sync/data/store.json` (tägliche Snapshots, App-Backups auf den Stick BrainUpdate).

- Einrichten / aktualisieren: `bash server/install.sh` (Zugangscode, CA und Daten bleiben erhalten; das Server-Zertifikat wird neu erzeugt)
- Autostart: LaunchAgent `de.step4step.heimsync`
- Erreichbar im Heim-WLAN über `<Mac>.local:8743`, unterwegs über die Tailscale-Adresse (`100.x` bzw. MagicDNS-Name) – beide stehen im Zertifikat.
- Nur Python-Standardbibliothek, keine Abhängigkeiten.
