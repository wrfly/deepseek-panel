import AppKit
import Foundation

let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "App/icon-1024.png"

let canvas: CGFloat = 1024
let image = NSImage(size: NSSize(width: canvas, height: canvas))
image.lockFocus()

let inset: CGFloat = 64
let rect = NSRect(x: inset, y: inset, width: canvas - inset * 2, height: canvas - inset * 2)
let path = NSBezierPath(roundedRect: rect, xRadius: 220, yRadius: 220)
let gradient = NSGradient(colors: [
    NSColor(calibratedRed: 0.25, green: 0.45, blue: 0.95, alpha: 1),
    NSColor(calibratedRed: 0.07, green: 0.16, blue: 0.48, alpha: 1)
])!
gradient.draw(in: path, angle: -90)

let whale = NSAttributedString(
    string: "🐋",
    attributes: [.font: NSFont.systemFont(ofSize: 520)]
)
let whaleSize = whale.size()
whale.draw(at: NSPoint(
    x: (canvas - whaleSize.width) / 2,
    y: (canvas - whaleSize.height) / 2 - 40
))

image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write("failed to render icon\n".data(using: .utf8)!)
    exit(1)
}

do {
    try png.write(to: URL(fileURLWithPath: output))
} catch {
    FileHandle.standardError.write("failed to write \(output): \(error)\n".data(using: .utf8)!)
    exit(1)
}
