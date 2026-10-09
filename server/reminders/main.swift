// Step4Step ↔ Apple-Erinnerungen (Liste „Step4Step“, sichtbar in Calendar 366)
//
// Läuft alle 2 Minuten auf dem Mac mini (LaunchAgent) und gleicht über den Heim-Sync-Server ab:
//   • neue Erinnerung in der Liste            → neue Aufgabe in Step4Step
//   • neue Aufgabe in Step4Step               → neue Erinnerung in der Liste
//   • Titel / Priorität geändert              → auf der anderen Seite übernommen (neuere Änderung gewinnt)
//   • in Step4Step erledigt                   → Erinnerung abgehakt
//   • in Calendar 366 abgehakt                → Aufgabe in Step4Step erledigt (Zeitprotokoll „done_extern“)
//   • gelöscht (egal wo)                      → wird NIE übertragen, nur die Verknüpfung gelöst
// Andere Erinnerungslisten werden nicht angefasst.
import Foundation
import EventKit

let LIST_NAME = ProcessInfo.processInfo.environment["S4S_LIST"] ?? "Step4Step"
let DEVICE = "reminders-bridge"
let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/S4S-Sync")
let statePath = dir.appendingPathComponent("reminders-bridge.json")
let logPath = dir.appendingPathComponent("reminders-bridge.log")

func log(_ s: String) {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm:ss"
    let line = "\(f.string(from: Date())) \(s)\n"
    if let h = try? FileHandle(forWritingTo: logPath) { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close() }
    else { try? line.write(to: logPath, atomically: true, encoding: .utf8) }
}
func fail(_ s: String) -> Never { log("FEHLER: \(s)"); exit(1) }

let isoFmt: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
func iso(_ t: Double) -> String { isoFmt.string(from: Date(timeIntervalSince1970: t)) }

// ── Server ──
guard let cfgData = try? Data(contentsOf: dir.appendingPathComponent("config.json")),
      let cfg = (try? JSONSerialization.jsonObject(with: cfgData)) as? [String: Any],
      let token = cfg["token"] as? String else { fail("config.json des Heim-Sync nicht lesbar") }
let port = (cfg["port"] as? Int) ?? 8743

final class LocalTrust: NSObject, URLSessionDelegate {
    // nur localhost: dem eigenen Heim-Zertifikat vertrauen
    func urlSession(_ s: URLSession, didReceive c: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if c.protectionSpace.host == "localhost", let t = c.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: t))
        } else { completionHandler(.performDefaultHandling, nil) }
    }
}
let session = URLSession(configuration: .ephemeral, delegate: LocalTrust(), delegateQueue: nil)

func post(_ body: [String: Any]) throws -> [String: Any] {
    var req = URLRequest(url: URL(string: "https://localhost:\(port)/api/sync")!)
    req.httpMethod = "POST"; req.timeoutInterval = 20
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.httpBody = try JSONSerialization.data(withJSONObject: body)
    let sem = DispatchSemaphore(value: 0)
    var out: Result<[String: Any], Error> = .failure(NSError(domain: "s4s", code: 0))
    session.dataTask(with: req) { d, r, e in
        defer { sem.signal() }
        if let e = e { out = .failure(e); return }
        let code = (r as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200, let d = d, let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else {
            out = .failure(NSError(domain: "s4s", code: code, userInfo: [NSLocalizedDescriptionKey: "Server antwortet mit HTTP \(code)"])); return
        }
        out = .success(j)
    }.resume()
    sem.wait()
    return try out.get()
}

// ── Zustand der Brücke (Verknüpfungen) ──
struct Link: Codable { var rid: String; var rmod: Double; var tupd: Double }
struct State: Codable {
    var links: [String: Link] = [:]     // Aufgaben-ID → Erinnerung
    var unlinked: Set<String> = []      // Aufgaben, die nicht (mehr) gespiegelt werden
    var ignored: Set<String> = []       // Erinnerungen, die nicht (mehr) importiert werden
}
var st = (try? JSONDecoder().decode(State.self, from: Data(contentsOf: statePath))) ?? State()
func saveState() {
    do { try JSONEncoder().encode(st).write(to: statePath, options: .atomic) } catch { log("Zustand nicht speicherbar: \(error)") }
}

// ── Erinnerungen ──
let store = EKEventStore()
func waitFor(_ done: () -> Bool) { while !done() { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) } }

var granted: Bool? = nil
if #available(macOS 14.0, *) { store.requestFullAccessToReminders { g, _ in granted = g } }
else { store.requestAccess(to: .reminder) { g, _ in granted = g } }
waitFor { granted != nil }
guard granted == true else { fail("Kein Zugriff auf Erinnerungen – Systemeinstellungen › Datenschutz › Erinnerungen › S4S-Erinnerungen erlauben") }

func findOrCreateList() -> EKCalendar {
    if let c = store.calendars(for: .reminder).first(where: { $0.title == LIST_NAME }) { return c }
    let c = EKCalendar(for: .reminder, eventStore: store)
    c.title = LIST_NAME
    guard let src = store.defaultCalendarForNewReminders()?.source ?? store.sources.first(where: { $0.sourceType == .calDAV })
    else { fail("Keine Quelle für Erinnerungen gefunden (iCloud angemeldet?)") }
    c.source = src
    do { try store.saveCalendar(c, commit: true) } catch { fail("Liste „\(LIST_NAME)“ nicht anlegbar: \(error)") }
    log("Liste „\(LIST_NAME)“ angelegt")
    return c
}
let cal = findOrCreateList()
var fetched: [EKReminder]? = nil
store.fetchReminders(matching: store.predicateForReminders(in: [cal])) { fetched = $0 ?? [] }
waitFor { fetched != nil }
let reminders = fetched!

func ekPrio(_ p: String?) -> Int { switch p { case "urgent", "high": return 1; case "low": return 9; default: return 5 } }
func s4sPrio(_ ek: Int, current: String?) -> String {
    if ek == ekPrio(current), let c = current { return c }   // „Dringend“ bleibt erhalten
    switch ek { case 1...4: return "high"; case 6...9: return "low"; default: return "medium" }
}
func mod(_ r: EKReminder) -> Double { r.lastModifiedDate?.timeIntervalSince1970 ?? 0 }
func num(_ v: Any?) -> Double { (v as? NSNumber)?.doubleValue ?? 0 }

// ── Stand vom Server holen (vollständig, über eine reine Lese-Kennung) ──
let full: [String: Any]
do { full = try post(["device": DEVICE + "-read", "name": "Erinnerungen (lesen)", "since": 0, "changes": [:] as [String: Any]]) }
catch { fail("Heim-Sync-Server nicht erreichbar: \(error.localizedDescription)") }
let rev = (full["rev"] as? Int) ?? 0
let ch = full["changes"] as? [String: Any] ?? [:]
var tasks: [String: [String: Any]] = [:]
for e in ch["tasks"] as? [[String: Any]] ?? [] {
    if e["deleted"] as? Bool != true, let id = e["id"] as? String, let r = e["record"] as? [String: Any] { tasks[id] = r }
}
var doneIds = Set<String>()
for e in ch["time_log"] as? [[String: Any]] ?? [] {
    if let r = e["record"] as? [String: Any], let o = r["outcome"] as? String, o == "ontime" || o == "overtime",
       let tid = r["task_id"] as? String { doneIds.insert(tid) }
}

// ── Abgleich ──
let now = Date().timeIntervalSince1970
var upserts: [[String: Any]] = [], deletes: [String] = [], timeLog: [[String: Any]] = []
var remSaves: [(tid: String, r: EKReminder, tupd: Double)] = []   // nach dem Speichern Zeitstempel übernehmen
let byRid = Dictionary(reminders.map { ($0.calendarItemIdentifier, $0) }, uniquingKeysWith: { a, _ in a })
let linkedRids = Set(st.links.values.map { $0.rid })
var stats = (toS4S: 0, toRem: 0, newTasks: 0, newRems: 0, doneS4S: 0, doneRem: 0)

for (tid, link0) in st.links {
    var link = link0
    // Erinnerungs-ID kann sich nach einem iCloud-Neuabgleich ändern → über gleichen Titel neu zuordnen
    if byRid[link.rid] == nil, let t = tasks[tid],
       let alt = reminders.first(where: { !linkedRids.contains($0.calendarItemIdentifier) && !st.ignored.contains($0.calendarItemIdentifier) && $0.title == (t["title"] as? String) }) {
        link.rid = alt.calendarItemIdentifier; st.links[tid] = link
    }
    let rem = byRid[link.rid]
    guard var t = tasks[tid] else {                                   // Aufgabe in Step4Step nicht mehr da
        if doneIds.contains(tid), let r = rem, !r.isCompleted {
            r.isCompleted = true; try? store.save(r, commit: false); stats.doneRem += 1
        } else if rem != nil { st.ignored.insert(link.rid) }          // gelöscht → Erinnerung bleibt, nur entkoppelt
        st.links[tid] = nil; continue
    }
    guard let r = rem else { st.links[tid] = nil; st.unlinked.insert(tid); continue }   // Erinnerung gelöscht → Aufgabe bleibt
    if r.isCompleted {                                                // in Calendar 366 abgehakt → erledigt
        deletes.append(tid)
        timeLog.append(["id": UUID().uuidString.lowercased(), "task_id": tid, "series_id": t["series_id"] ?? tid,
                        "title": t["title"] ?? "", "category": t["category"] ?? "", "priority": t["priority"] ?? "medium",
                        "estimated_minutes": t["estimated_minutes"] ?? 5, "outcome": "done_extern", "points": 0, "date": iso(now)])
        st.links[tid] = nil; st.ignored.insert(link.rid); stats.doneS4S += 1; continue
    }
    let rmod = mod(r), tupd = num(t["updatedAt"]) / 1000
    let rChanged = rmod > link.rmod + 0.5, tChanged = tupd > link.tupd + 0.001
    if rChanged && (!tChanged || rmod >= tupd) {
        let title = r.title ?? "", prio = s4sPrio(r.priority, current: t["priority"] as? String)
        if (t["title"] as? String) != title || (t["priority"] as? String) != prio {
            t["title"] = title; t["priority"] = prio; t["updatedAt"] = Int(now * 1000); upserts.append(t); stats.toS4S += 1
            st.links[tid] = Link(rid: link.rid, rmod: rmod, tupd: now)
        } else { st.links[tid] = Link(rid: link.rid, rmod: rmod, tupd: tupd) }
    } else if tChanged {
        let title = t["title"] as? String ?? "", prio = ekPrio(t["priority"] as? String)
        if r.title != title || r.priority != prio {
            r.title = title; r.priority = prio; try? store.save(r, commit: false); stats.toRem += 1
            remSaves.append((tid, r, tupd))
        } else { st.links[tid] = Link(rid: link.rid, rmod: rmod, tupd: tupd) }
    }
}

// neue Erinnerungen → neue Aufgaben
let allLinked = Set(st.links.values.map { $0.rid })
for r in reminders where !r.isCompleted && !allLinked.contains(r.calendarItemIdentifier) && !st.ignored.contains(r.calendarItemIdentifier) {
    let tid = UUID().uuidString.lowercased()
    upserts.append(["id": tid, "title": r.title ?? "(ohne Titel)", "category": "Privat",
                    "priority": s4sPrio(r.priority, current: nil), "difficulty": "medium", "estimated_minutes": 5,
                    "status": "later", "recurring": false, "postpone_count": 0, "today_order": 0,
                    "created_at": iso(now), "done_at": NSNull(), "actual_minutes": NSNull(),
                    "updatedAt": Int(now * 1000), "source": "erinnerungen"])
    st.links[tid] = Link(rid: r.calendarItemIdentifier, rmod: mod(r), tupd: now); stats.newTasks += 1
}

// neue Aufgaben → neue Erinnerungen
for (tid, t) in tasks where st.links[tid] == nil && !st.unlinked.contains(tid) && !deletes.contains(tid) {
    let r = EKReminder(eventStore: store)
    r.calendar = cal; r.title = t["title"] as? String ?? "(ohne Titel)"; r.priority = ekPrio(t["priority"] as? String)
    do { try store.save(r, commit: false); remSaves.append((tid, r, num(t["updatedAt"]) / 1000)); stats.newRems += 1 }
    catch { log("Erinnerung nicht anlegbar (\(r.title ?? "")): \(error)") }
}

// 1. Server zuerst (schlägt das fehl, bleibt alles beim Alten und wird beim nächsten Lauf wiederholt)
if !upserts.isEmpty || !deletes.isEmpty || !timeLog.isEmpty {
    var changes: [String: Any] = [:]
    if !upserts.isEmpty || !deletes.isEmpty { changes["tasks"] = ["upserts": upserts, "deletes": deletes] }
    if !timeLog.isEmpty { changes["time_log"] = ["upserts": timeLog, "deletes": [String]()] }
    do { _ = try post(["device": DEVICE, "name": "Erinnerungen (Calendar 366)", "since": rev, "changes": changes]) }
    catch { store.reset(); fail("Hochladen fehlgeschlagen: \(error.localizedDescription)") }
}
// 2. dann Erinnerungen speichern und Zeitstempel merken
do { try store.commit() } catch { log("Erinnerungen nicht gespeichert: \(error)") }
for s in remSaves { st.links[s.tid] = Link(rid: s.r.calendarItemIdentifier, rmod: mod(s.r), tupd: s.tupd) }
saveState()

let summary = "→S4S \(stats.toS4S), →Erinnerung \(stats.toRem), neu in S4S \(stats.newTasks), neu als Erinnerung \(stats.newRems), erledigt in S4S \(stats.doneS4S), abgehakt \(stats.doneRem)"
if stats.toS4S + stats.toRem + stats.newTasks + stats.newRems + stats.doneS4S + stats.doneRem > 0 || CommandLine.arguments.contains("--once") {
    log("Abgleich: \(summary)")
}
