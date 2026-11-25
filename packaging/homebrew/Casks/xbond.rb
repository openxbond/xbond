cask "xbond" do
  arch arm: "arm64", intel: "amd64"

  version "1.1.2"
  sha256 arm: "d3f8c919b7c50ae17967f098d9e6c87e01f1e8b180c44fc03f05ee6cf1c315a0",
         intel: "f69b286e51bf08f5bf37ef894da5127062beb9f8b19e63f09b4c44679b5e410d"

  url "https://github.com/openxbond/xbond/releases/download/v#{version}/xbond-desktop-v#{version}-darwin-#{arch}.dmg",
      verified: "github.com/openxbond/xbond/"
  name "XBond"
  desc "Cross-platform dual-core (mihomo + sing-box) proxy client"
  homepage "https://www.xbond.net/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true

  app "XBond.app"

  zap trash: [
    "~/Library/Application Support/net.xbond.app",
    "~/Library/Caches/net.xbond.app",
    "~/Library/Preferences/net.xbond.app.plist",
    "~/Library/Saved Application State/net.xbond.app.savedState",
  ]
end
