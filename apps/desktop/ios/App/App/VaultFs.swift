import Capacitor
import Foundation
import UIKit
import UniformTypeIdentifiers

/**
 SelfOS `VaultFs` Capacitor plugin (07-mobile-platform §5.4, slice iii-b3).

 Gives the WKWebView a security-scoped, coordinated filesystem over the user's **own iCloud-Drive
 folder** — the *same* vault desktop uses. Access is granted via the document picker + a security-scoped
 bookmark (NO iCloud-container entitlement needed, §11.6). The TS side (`capacitorVaultFs.ts`) holds the
 opaque bookmark (base64) and passes it to every call; here we resolve it, bracket the op in
 `start/stopAccessingSecurityScopedResource`, and coordinate I/O with `NSFileCoordinator`. Bytes cross
 the bridge base64-encoded.

 Deferred to iii-b3b: an `NSFilePresenter` that pushes `onVaultChanged` when another device edits the
 vault (the JS `onVaultChanged` is a no-op for now — reads are always fresh).
 Deferred (open Q8, §7): rich download-on-demand UX for not-yet-downloaded ubiquitous files. Coordinated
 reads materialize files on access; a directory of `.<name>.icloud` placeholders isn't special-cased yet.

 NOTE (Xcode): this file must be a member of the `App` target. If Capacitor doesn't pick the plugin up,
 confirm it's in the target's Compile Sources. No Info.plist key is required for folder-picker access.
 */
@objc(VaultFsPlugin)
public class VaultFsPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "VaultFsPlugin"
    public let jsName = "VaultFs"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickFolder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeAtomic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startWatch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopWatch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "findConflicts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasPendingDownloads", returnType: CAPPluginReturnPromise)
    ]

    /// The in-flight `pickFolder` call, resolved/rejected by the picker delegate callbacks.
    private var pickCall: CAPPluginCall?

    /// The active vault-directory change observer (iii-b3b) + the URL whose security scope it holds.
    private var presenter: VaultPresenter?
    private var watchedVaultURL: URL?
    /// The bookmark to (re-)arm the watch from; survives backgrounding so foreground can resume it.
    private var watchedBookmark: String?
    private var lifecycleObserved = false

    // MARK: - Folder picker

    @objc func pickFolder(_ call: CAPPluginCall) {
        pickCall = call
        DispatchQueue.main.async {
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            picker.allowsMultipleSelection = false
            picker.delegate = self
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func documentPicker(
        _ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]
    ) {
        guard let call = pickCall else { return }
        pickCall = nil
        guard let url = urls.first else {
            call.reject("No folder selected")
            return
        }
        let didAccess = url.startAccessingSecurityScopedResource()
        defer { if didAccess { url.stopAccessingSecurityScopedResource() } }
        do {
            let bookmark = try url.bookmarkData(
                options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
            call.resolve([
                "bookmark": bookmark.base64EncodedString(),
                "name": url.lastPathComponent
            ])
        } catch {
            call.reject("Could not bookmark the folder: \(error.localizedDescription)")
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickCall?.reject("Folder selection cancelled", "CANCELLED")
        pickCall = nil
    }

    // MARK: - Coordinated filesystem ops (bookmark → security scope → NSFileCoordinator)

    /// Resolve a base64 security-scoped bookmark to its vault URL (a stale-but-resolvable bookmark still
    /// grants access; re-minting it is a later refinement). Returns nil if it can't be decoded/resolved.
    private func resolveBookmarkURL(_ base64: String) -> URL? {
        guard let data = Data(base64Encoded: base64) else { return nil }
        var stale = false
        return try? URL(
            resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
    }

    /// Resolve the security-scoped vault root from the call's bookmark, or reject and return nil.
    private func resolveVault(_ call: CAPPluginCall) -> URL? {
        guard let raw = call.getString("bookmark") else {
            call.reject("Missing bookmark")
            return nil
        }
        guard let url = resolveBookmarkURL(raw) else {
            call.reject("Could not resolve the vault folder — re-pick it.", "STALE_BOOKMARK")
            return nil
        }
        return url
    }

    /// Resolve a vault-relative POSIX path (e.g. `config/settings.json`) against the vault root.
    private func fileURL(_ vault: URL, _ path: String) -> URL {
        return URL(fileURLWithPath: path, relativeTo: vault)
    }

    /**
     Ensure a vault file is available locally, **downloading a not-yet-downloaded iCloud item on demand**
     (07-mobile-platform §7, Q8). A fresh device sees another device's files as iCloud placeholders
     (`.<name>.icloud`) that `fileExists` reports as absent — which is why the very first cross-device
     read (e.g. `config/recovery.enc`) otherwise looked like an empty vault. Returns `false` when the file
     is genuinely absent (no placeholder), or — rarely, e.g. offline — when the bounded wait elapses before
     it materializes (tiny `.enc` files normally download in well under a second once triggered).
     Runs on Capacitor's background queue, so the brief poll-sleep doesn't block the UI.
     */
    private func ensureDownloaded(_ url: URL) -> Bool {
        let fm = FileManager.default
        if fm.fileExists(atPath: url.path) { return true }
        let placeholder = url.deletingLastPathComponent()
            .appendingPathComponent(".\(url.lastPathComponent).icloud")
        guard fm.fileExists(atPath: placeholder.path) else { return false }  // truly absent
        try? fm.startDownloadingUbiquitousItem(at: url)
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline {
            if fm.fileExists(atPath: url.path) { return true }
            Thread.sleep(forTimeInterval: 0.25)
        }
        return fm.fileExists(atPath: url.path)
    }

    @objc func read(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing path")
            return
        }
        guard let vault = resolveVault(call) else { return }
        let didAccess = vault.startAccessingSecurityScopedResource()
        defer { if didAccess { vault.stopAccessingSecurityScopedResource() } }

        let target = fileURL(vault, path)
        // Materialize a not-yet-downloaded iCloud item first (download-on-demand), outside the
        // coordinated read so we don't hold the coordination claim during the download.
        guard ensureDownloaded(target) else {
            call.resolve(["data": NSNull()])  // genuinely absent → null (the FileSystem contract)
            return
        }
        let coordinator = NSFileCoordinator()
        var coordError: NSError?
        var ran = false
        var opError: String?
        var data: Any = NSNull()
        coordinator.coordinate(readingItemAt: target, options: [], error: &coordError) { readURL in
            ran = true
            guard FileManager.default.fileExists(atPath: readURL.path) else { return }
            do { data = try Data(contentsOf: readURL).base64EncodedString() } catch {
                opError = "Read failed: \(error.localizedDescription)"
            }
        }
        // Settle the call exactly once, AFTER coordinate returns — never inside the block (a block that
        // doesn't run must still reject, or the JS promise hangs and boot freezes).
        if let coordError = coordError {
            call.reject("Read coordination failed: \(coordError.localizedDescription)")
        } else if !ran {
            call.reject("Read produced no result")
        } else if let opError = opError {
            call.reject(opError)
        } else {
            call.resolve(["data": data])
        }
    }

    @objc func writeAtomic(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let raw = call.getString("data"),
            let bytes = Data(base64Encoded: raw)
        else {
            call.reject("Missing path or data")
            return
        }
        guard let vault = resolveVault(call) else { return }
        let didAccess = vault.startAccessingSecurityScopedResource()
        defer { if didAccess { vault.stopAccessingSecurityScopedResource() } }

        let target = fileURL(vault, path)
        let coordinator = NSFileCoordinator()
        var coordError: NSError?
        var ran = false
        var opError: String?
        coordinator.coordinate(writingItemAt: target, options: .forReplacing, error: &coordError) {
            writeURL in
            ran = true
            do {
                try FileManager.default.createDirectory(
                    at: writeURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                // .atomic = temp-file + rename (the spec's writeAtomic), inside the coordinated replace.
                try bytes.write(to: writeURL, options: .atomic)
            } catch {
                opError = "Write failed: \(error.localizedDescription)"
            }
        }
        if let coordError = coordError {
            call.reject("Write coordination failed: \(coordError.localizedDescription)")
        } else if !ran {
            call.reject("Write produced no result")
        } else if let opError = opError {
            call.reject(opError)
        } else {
            call.resolve()
        }
    }

    @objc func list(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing path")
            return
        }
        guard let vault = resolveVault(call) else { return }
        let didAccess = vault.startAccessingSecurityScopedResource()
        defer { if didAccess { vault.stopAccessingSecurityScopedResource() } }

        let target = fileURL(vault, path)
        let coordinator = NSFileCoordinator()
        var coordError: NSError?
        var entries: [String] = []
        coordinator.coordinate(readingItemAt: target, options: [], error: &coordError) { readURL in
            // Absent dir → [] (matches the FileSystem contract); contentsOfDirectory throws otherwise.
            let raw = (try? FileManager.default.contentsOfDirectory(atPath: readURL.path)) ?? []
            // Map not-downloaded iCloud placeholders ".<real>.icloud" back to their real names, so a
            // directory of cloud-only files (a fresh cross-device read) lists the names the app expects.
            entries = raw.map { name in
                (name.hasPrefix(".") && name.hasSuffix(".icloud"))
                    ? String(name.dropFirst().dropLast(".icloud".count))
                    : name
            }
        }
        // list never rejects on absence/coordination failure — an absent or unreadable dir is just [].
        call.resolve(["entries": entries])
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing path")
            return
        }
        guard let vault = resolveVault(call) else { return }
        let didAccess = vault.startAccessingSecurityScopedResource()
        defer { if didAccess { vault.stopAccessingSecurityScopedResource() } }

        let target = fileURL(vault, path)
        let coordinator = NSFileCoordinator()
        var coordError: NSError?
        var ran = false
        var opError: String?
        coordinator.coordinate(writingItemAt: target, options: .forDeleting, error: &coordError) {
            deleteURL in
            ran = true
            do {
                if FileManager.default.fileExists(atPath: deleteURL.path) {
                    try FileManager.default.removeItem(at: deleteURL)  // recursive for directories
                }
            } catch {
                opError = "Remove failed: \(error.localizedDescription)"
            }
        }
        if let coordError = coordError {
            call.reject("Remove coordination failed: \(coordError.localizedDescription)")
        } else if !ran {
            call.reject("Remove produced no result")
        } else if let opError = opError {
            call.reject(opError)
        } else {
            call.resolve()
        }
    }

    // MARK: - Change feed (iii-b3b)

    /**
     Start observing the vault directory and fire a `vaultChanged` event when its contents change —
     including iCloud syncs pushed from another device (the system applies those via coordinated writes,
     which notify `NSFilePresenter`s). The renderer subscribes via the plugin's `addListener` and refreshes
     (e.g. the sync-conflict banner). Security scope is held for the lifetime of the watch.
     */
    @objc func startWatch(_ call: CAPPluginCall) {
        guard let raw = call.getString("bookmark") else {
            call.reject("Missing bookmark")
            return
        }
        watchedBookmark = raw
        observeLifecycle()
        if arm(raw) {
            call.resolve()
        } else {
            call.reject("Could not access the vault folder to watch it")
        }
    }

    @objc func stopWatch(_ call: CAPPluginCall) {
        watchedBookmark = nil
        disarm()
        call.resolve()
    }

    /// Resolve the bookmark, hold its security scope, and register the directory presenter. Returns
    /// false on a missing/unresolvable bookmark or denied access. Replaces any existing watch.
    private func arm(_ bookmark: String) -> Bool {
        disarm()
        guard let vault = resolveBookmarkURL(bookmark), vault.startAccessingSecurityScopedResource()
        else {
            return false
        }
        let presenter = VaultPresenter(url: vault) { [weak self] in
            self?.notifyListeners("vaultChanged", data: [:])
        }
        NSFileCoordinator.addFilePresenter(presenter)
        self.presenter = presenter
        self.watchedVaultURL = vault
        return true
    }

    /// Remove the presenter + release the security scope (idempotent). Keeps `watchedBookmark` so a
    /// foreground re-arm can resume; only `stopWatch` clears the bookmark.
    private func disarm() {
        if let presenter = presenter {
            NSFileCoordinator.removeFilePresenter(presenter)
            self.presenter = nil
        }
        if let url = watchedVaultURL {
            url.stopAccessingSecurityScopedResource()
            self.watchedVaultURL = nil
        }
    }

    /// Drop the presenter + scope while backgrounded (so a suspended app doesn't hold a coordination
    /// presenter or a leaked security scope), and re-arm on foreground. Registered once.
    private func observeLifecycle() {
        guard !lifecycleObserved else { return }
        lifecycleObserved = true
        let center = NotificationCenter.default
        center.addObserver(
            self, selector: #selector(onBackground),
            name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(
            self, selector: #selector(onForeground),
            name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    @objc private func onBackground() {
        disarm()
    }

    @objc private func onForeground() {
        if let bookmark = watchedBookmark, presenter == nil { _ = arm(bookmark) }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        disarm()
    }

    // MARK: - Sync conflicts + pending downloads (29-multi-device-housekeeping §5.C/§5.D)

    /// Vault-relative paths of files with UNRESOLVED iCloud conflict versions — the iCloud-native signal
    /// (`NSFileVersion.unresolvedConflictVersionsOfItem(at:)`), plus the shared "conflicted copy" name
    /// pattern as a cheap second signal. Read-only: never reads, writes, or resolves a conflicted file.
    /// (Blind-written; verify on-device by inducing a conflict on two devices then syncing.)
    @objc func findConflicts(_ call: CAPPluginCall) {
        guard let vault = resolveVault(call) else { return }
        let didAccess = vault.startAccessingSecurityScopedResource()
        defer { if didAccess { vault.stopAccessingSecurityScopedResource() } }

        var conflicts: [String] = []
        let coordinator = NSFileCoordinator()
        var coordError: NSError?
        coordinator.coordinate(readingItemAt: vault, options: [], error: &coordError) { readURL in
            guard let walker = FileManager.default.enumerator(
                at: readURL, includingPropertiesForKeys: [.isRegularFileKey], options: []) else { return }
            for case let fileURL as URL in walker {
                let isFile = (try? fileURL.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile ?? false
                if !isFile { continue }
                let rel = fileURL.path.hasPrefix(readURL.path)
                    ? String(fileURL.path.dropFirst(readURL.path.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                    : fileURL.lastPathComponent
                let hasVersionConflict =
                    (NSFileVersion.unresolvedConflictVersionsOfItem(at: fileURL)?.isEmpty == false)
                let name = fileURL.lastPathComponent.lowercased()
                let looksLikeCopy = name.contains("conflicted copy")
                if hasVersionConflict || looksLikeCopy { conflicts.append(rel) }
            }
        }
        // Like `list`, never reject on a coordination failure — an unreadable vault is just "no conflicts".
        call.resolve(["conflicts": conflicts])
    }

    /// Whether the vault still has not-yet-downloaded iCloud items (29 §5.D) — a `.<name>.icloud` placeholder
    /// anywhere means a cross-device read might not see the real `config/recovery.enc` yet. Best-effort.
    @objc func hasPendingDownloads(_ call: CAPPluginCall) {
        guard let vault = resolveVault(call) else { return }
        let didAccess = vault.startAccessingSecurityScopedResource()
        defer { if didAccess { vault.stopAccessingSecurityScopedResource() } }

        var pending = false
        let coordinator = NSFileCoordinator()
        var coordError: NSError?
        coordinator.coordinate(readingItemAt: vault, options: [], error: &coordError) { readURL in
            guard let walker = FileManager.default.enumerator(at: readURL, includingPropertiesForKeys: nil, options: []) else { return }
            for case let fileURL as URL in walker {
                let n = fileURL.lastPathComponent
                if n.hasPrefix(".") && n.hasSuffix(".icloud") { pending = true; break }
            }
        }
        call.resolve(["pending": pending])
    }
}

/// Observes a directory for changes (incl. iCloud remote syncs) and invokes `onChange` on each.
private class VaultPresenter: NSObject, NSFilePresenter {
    let presentedItemURL: URL?
    let presentedItemOperationQueue: OperationQueue
    private let onChange: () -> Void

    init(url: URL, onChange: @escaping () -> Void) {
        self.presentedItemURL = url
        self.presentedItemOperationQueue = OperationQueue()
        self.onChange = onChange
        super.init()
    }

    func presentedSubitemDidChange(at url: URL) { onChange() }
    func presentedItemDidChange() { onChange() }
}
