// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "DeepSeekPanel",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "DeepSeekPanel",
            path: "Sources/DeepSeekPanel"
        )
    ]
)
