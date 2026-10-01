import SwiftUI

@main
struct BookmarkCareApp: App {
    var body: some Scene {
        WindowGroup {
            BookmarkWebView()
                .ignoresSafeArea()
        }
    }
}
