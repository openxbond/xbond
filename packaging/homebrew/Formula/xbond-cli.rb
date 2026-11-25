class XbondCli < Formula
  desc "Cross-platform dual-core (mihomo + sing-box) proxy CLI and daemon"
  homepage "https://www.xbond.net/"
  version "1.1.2"
  license "AGPL-3.0-only"

  on_macos do
    on_arm do
      url "https://github.com/openxbond/xbond/releases/download/v1.1.2/xbond-v1.1.2-darwin-arm64"
      sha256 "1a0460ab09041e1aeb8b1039a9507da9cb8fa13c5352e438c3b3b474d88ca7b0"
    end

    on_intel do
      url "https://github.com/openxbond/xbond/releases/download/v1.1.2/xbond-v1.1.2-darwin-amd64"
      sha256 "190aaa1ca695f51e6e078789facbbd6bdc70299f6f3a0a5bf309a250f432d42e"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/openxbond/xbond/releases/download/v1.1.2/xbond-v1.1.2-linux-arm64"
      sha256 "62e9f31ddc8a23f51ff2d4b643fcb025f64eef1481f47ccf47123e86a6074831"
    end

    on_intel do
      url "https://github.com/openxbond/xbond/releases/download/v1.1.2/xbond-v1.1.2-linux-amd64"
      sha256 "13e665493e304355722679af4ab4c9971f7e5501d4af654e3de658a75c2d854e"
    end
  end

  def install
    binary = Dir["xbond-v*"].first || "xbond"
    bin.install binary => "xbond"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/xbond version")
  end
end
