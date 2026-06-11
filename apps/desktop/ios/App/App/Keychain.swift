import Capacitor
import Foundation
import Security

/**
 SelfOS `Keychain` Capacitor plugin (07-mobile-platform §5.1/§5.3, slice iii-c1) — the iOS
 `SecretStore` host. Holds device-local secrets (the vault master key + the Claude API key) in the iOS
 Keychain, replacing the iii-b2 `localStorage` stub. Items are `kSecClassGenericPassword`, scoped to the
 app via `kSecAttrService` = the bundle id, accessible **after first unlock, this device only**, and
 **not** synced to iCloud Keychain (no `kSecAttrSynchronizable`). Secrets never enter the vault or the
 renderer in plaintext (00-architecture §6.2); the TS `capacitorSecretStore` adapter wraps this.

 NOTE (Xcode): add this file to the `App` target (Reference in place); it's registered in
 `MainViewController.capacitorDidLoad`.
 */
@objc(KeychainPlugin)
public class KeychainPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KeychainPlugin"
    public let jsName = "Keychain"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "has", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    /// Scope all items to this app (so two apps can't read each other's secrets).
    private var service: String {
        return Bundle.main.bundleIdentifier ?? "com.highfivery.selfos"
    }

    private func baseQuery(_ account: String) -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    @objc func get(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Missing id")
            return
        }
        var query = baseQuery(id)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            call.resolve(["value": NSNull()])  // absent → null (the SecretStore contract)
            return
        }
        guard status == errSecSuccess, let data = item as? Data,
            let value = String(data: data, encoding: .utf8)
        else {
            call.reject("Keychain read failed (\(status))")
            return
        }
        call.resolve(["value": value])
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let value = call.getString("value"),
            let data = value.data(using: .utf8)
        else {
            call.reject("Missing id or value")
            return
        }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        // Upsert: update if present, else add.
        let updateStatus = SecItemUpdate(baseQuery(id) as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            call.resolve()
            return
        }
        if updateStatus == errSecItemNotFound {
            var addQuery = baseQuery(id)
            addQuery[kSecValueData as String] = data
            addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            if addStatus == errSecSuccess {
                call.resolve()
            } else {
                call.reject("Keychain add failed (\(addStatus))")
            }
            return
        }
        call.reject("Keychain update failed (\(updateStatus))")
    }

    @objc func has(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Missing id")
            return
        }
        var query = baseQuery(id)
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        call.resolve(["value": status == errSecSuccess])
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Missing id")
            return
        }
        let status = SecItemDelete(baseQuery(id) as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            call.resolve()
        } else {
            call.reject("Keychain delete failed (\(status))")
        }
    }
}
