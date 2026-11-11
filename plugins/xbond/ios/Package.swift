// swift-tools-version:5.9
import Foundation
import PackageDescription

// SwiftPM runs on the Mac host under swift-rs. Use the common gomobile
// headers here and let Xcode link the XCFramework slice for each target.
let headers = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
  .appendingPathComponent("Frameworks/XBondMobile.xcframework/ios-arm64").path

let package = Package(
  name: "tauri-plugin-xbond",
  platforms: [
    .iOS(.v16),
  ],
  products: [
    // Products define the executables and libraries a package produces, and make them visible to other packages.
    .library(
      name: "tauri-plugin-xbond",
      type: .static,
      targets: ["tauri-plugin-xbond"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    // Targets are the basic building blocks of a package. A target can define a module or a test suite.
    // Targets can depend on other targets in this package, and on products in packages this package depends on.
    .target(
      name: "tauri-plugin-xbond",
      dependencies: [
        .byName(name: "Tauri"),
      ],
      path: "Sources",
      swiftSettings: [.unsafeFlags(["-F", headers])])
  ]
)
