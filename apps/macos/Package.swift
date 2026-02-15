// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AetherClawMac",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "AetherClawMac", targets: ["AetherClawMac"]),
    ],
    targets: [
        .executableTarget(name: "AetherClawMac", path: "Sources"),
    ]
)
