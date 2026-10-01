import NetworkExtension
import SwiftUI
import WebKit

struct BookmarkWebView: UIViewRepresentable {
    private let bridgeName = "bookmarkWifi"

    func makeCoordinator() -> Coordinator {
        Coordinator(bridgeName: bridgeName)
    }

    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: bridgeName)
        contentController.addUserScript(WKUserScript(
            source: Self.nativeBridgeScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController
        configuration.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        context.coordinator.webView = webView
        loadBookmark(in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: coordinator.bridgeName)
    }

    private func loadBookmark(in webView: WKWebView) {
        guard
            let address = Bundle.main.object(forInfoDictionaryKey: "BookmarkServerURL") as? String,
            let url = URL(string: address)
        else { return }

        webView.load(URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: 20
        ))
    }

    private static let nativeBridgeScript = """
    window.BookmarkNative = {
      connectWifi: function(ssid, password) {
        window.webkit.messageHandlers.bookmarkWifi.postMessage({
          action: 'connect',
          ssid: String(ssid || ''),
          password: String(password || '')
        });
        return true;
      },
      disconnectWifi: function(ssid) {
        window.webkit.messageHandlers.bookmarkWifi.postMessage({
          action: 'disconnect',
          ssid: String(ssid || '')
        });
        return true;
      }
    };
    """

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let bridgeName: String
        weak var webView: WKWebView?

        init(bridgeName: String) {
            self.bridgeName = bridgeName
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard
                message.name == bridgeName,
                let body = message.body as? [String: Any],
                let ssid = body["ssid"] as? String,
                !ssid.isEmpty
            else {
                emitResult(success: false, message: "Wi-Fi 연결 정보가 올바르지 않습니다.")
                return
            }

            if body["action"] as? String == "disconnect" {
                NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: ssid)
                return
            }

            guard let password = body["password"] as? String, password.count >= 8 else {
                emitResult(success: false, message: "Wi-Fi 비밀번호가 올바르지 않습니다.")
                return
            }
            connectToNecklace(ssid: ssid, password: password)
        }

        private func connectToNecklace(ssid: String, password: String) {
            let configuration = NEHotspotConfiguration(
                ssid: ssid,
                passphrase: password,
                isWEP: false
            )
            configuration.joinOnce = true

            NEHotspotConfigurationManager.shared.apply(configuration) { [weak self] error in
                guard let self else { return }
                if let error {
                    let nsError = error as NSError
                    if nsError.domain == NEHotspotConfigurationErrorDomain && nsError.code == 13 {
                        self.emitResult(success: true, message: "Bookmark_Necklace에 이미 연결되어 있습니다.")
                    } else if nsError.domain == NEHotspotConfigurationErrorDomain && nsError.code == 7 {
                        self.emitResult(success: false, message: "아이폰의 Wi-Fi 연결 승인이 취소되었습니다.")
                    } else {
                        self.emitResult(success: false, message: "Bookmark_Necklace 연결에 실패했습니다. 목걸이 전원을 확인해주세요.")
                    }
                    return
                }

                self.emitResult(success: true, message: "Bookmark_Necklace 자동 연결을 시작했습니다.")
            }
        }

        private func emitResult(success: Bool, message: String) {
            let payload: [String: Any] = [
                "success": success,
                "message": message
            ]
            guard
                let data = try? JSONSerialization.data(withJSONObject: payload),
                let json = String(data: data, encoding: .utf8)
            else { return }

            let script = "window.dispatchEvent(new CustomEvent('bookmark:native-wifi-result', { detail: \(json) }));"
            DispatchQueue.main.async { [weak self] in
                self?.webView?.evaluateJavaScript(script)
            }
        }
    }
}
