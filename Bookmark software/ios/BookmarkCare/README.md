# Bookmark Care iPhone app

This native wrapper loads the Bookmark app from the laptop server and exposes
`NEHotspotConfiguration` to the existing `Bookmark_Necklace` connect button.

1. Keep the laptop and iPhone on the same Wi-Fi and run `npm start`.
2. Open `BookmarkCare.xcodeproj` in Xcode.
3. Select the `BookmarkCare` target, then choose your Apple development team in Signing & Capabilities.
4. Confirm that the Hotspot Configuration capability is present.
5. Select the connected iPhone and press Run.

The first connection requires Apple's system Join confirmation. After approval,
the app joins `Bookmark_Necklace` without opening Settings or typing a password.
The server URL is stored in `BookmarkCare/Info.plist` as `BookmarkServerURL`.
