package net.xbond.app.xbond

/**
 * Distinct FileProvider subclass for the update APK: the Tauri gen app
 * manifest already declares `androidx.core.content.FileProvider` for the
 * webview file chooser, and the manifest merger conflicts on the node name
 * when two libraries declare the same class. A dedicated subclass keeps
 * both providers and their authorities separate.
 */
class UpdatesFileProvider : androidx.core.content.FileProvider()
