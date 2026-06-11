import Capacitor
import UIKit

/**
 The app's Capacitor bridge view controller (07-mobile-platform §5.4). Its only job is to register
 SelfOS's **app-local** plugins: unlike plugins shipped as Swift packages (auto-discovered via their
 podspec), a plugin defined inside the app target must be registered explicitly in `capacitorDidLoad`.
 Main.storyboard points its root view controller at this class.
 */
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(VaultFsPlugin())
    }
}
