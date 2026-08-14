// gen_icon.go 生成托盘图标 whale.png（独立小工具，go run scripts/gen_icon.go）
package main

import (
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
)

const size = 64

var (
	bodyBlue    = color.RGBA{0x2E, 0x86, 0xDE, 0xFF}
	bellyBlue   = color.RGBA{0x85, 0xC1, 0xE9, 0xFF}
	darkBlue    = color.RGBA{0x1A, 0x52, 0x76, 0xFF}
	white       = color.RGBA{0xFF, 0xFF, 0xFF, 0xFF}
	transparent = color.RGBA{0, 0, 0, 0}
)

func inEllipse(x, y, cx, cy, rx, ry float64) bool {
	dx, dy := (x-cx)/rx, (y-cy)/ry
	return dx*dx+dy*dy <= 1
}

func inTail(x, y float64) bool {
	if x < 46 || x > 64 {
		return false
	}
	// 上鳍三角形 (46,42)-(64,26)-(64,42)
	if y >= 26 && y <= 42 && y <= 42-(x-46)*0.5 {
		return true
	}
	// 下鳍三角形 (46,42)-(64,58)-(64,42)
	if y >= 42 && y <= 58 && y >= 42+(x-46)*0.5 {
		return true
	}
	return false
}

func main() {
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			fx, fy := float64(x)+0.5, float64(y)+0.5
			c := transparent
			switch {
			case inTail(fx, fy):
				c = bodyBlue
			case inEllipse(fx, fy, 32, 42, 21, 12):
				if fy > 46 && inEllipse(fx, fy, 32, 46, 14, 6) {
					c = bellyBlue
				} else {
					c = bodyBlue
				}
			case inEllipse(fx, fy, 21, 42, 8, 8):
				c = bodyBlue
			case inEllipse(fx, fy, 16, 38, 3, 3):
				c = white
			case math.Hypot(fx-17, fy-38) <= 1.4:
				c = darkBlue
			case math.Hypot(fx-25, fy-50) <= 2.2:
				c = bellyBlue
			}
			img.Set(x, y, c)
		}
	}
	f, err := os.Create("internal/tray/linux/whale.png")
	if err != nil {
		panic(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		panic(err)
	}
	println("written internal/tray/linux/whale.png")
}
