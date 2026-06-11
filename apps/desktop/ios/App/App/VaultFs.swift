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
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    /// The in-flight `pickFolder` call, resolved/rejected by the picker delegate callbacks.
    private var pickCall: CAPPluginCall?

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

    /// Resolve the security-scoped vault root from the call's bookmark, or reject and return nil.
    private func resolveVault(_ call: CAPPluginCall) -> URL? {
        guard let raw = call.getString("bookmark"), let data = Data(base64Encoded: raw) else {
            call.reject("Missing or invalid bookmark")
            return nil
        }
        var stale = false
        do {
            // A stale-but-resolvable bookmark still grants access; rebooking it is a iii-b3b refinement.
            return try URL(
                resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
        } catch {
            call.reject("Could not resolve the vault folder — re-pick it.", "STALE_BOOKMARK", error)
            return nil
        }
    }

    /// Resolve a vault-relative POSIX path (e.g. `config/settings.json`) against the vault root.
    private func fileURL(_ vault: URL, _ path: String) -> URL {
        return URL(fileURLWithPath: path, relativeTo: vault)
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
        let coordinator = NSFileCoordinator()
        var coordError: NSError?
        var ran = false
        var opError: String?
        var data: Any = NSNull()  // absent → null (the FileSystem contract)
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
            entries = (try? FileManager.default.contentsOfDirectory(atPath: readURL.path)) ?? []
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
}
