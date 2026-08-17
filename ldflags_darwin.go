//go:build darwin

// Wails v2.14.0 的 macOS 前端（WailsContext.m）在 macOS 15+ 上使用 UTType
// 实现文件打开/拖放过滤，但链接时未包含 UniformTypeIdentifiers 框架，
// 导致 Apple Silicon 构建报 "_OBJC_CLASS_$_UTType" undefined symbol。
// 这里显式声明该框架，让任何构建方式（make mac / make build）都能通过。
package main

/*
#cgo LDFLAGS: -framework UniformTypeIdentifiers
*/
import "C"
