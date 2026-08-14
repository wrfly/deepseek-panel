// gen_icon.go 生成多尺寸托盘图标（22/24/32/48/64px）。
// 鲸鱼形状按 22x22 基准网格定义并等比缩放，保证托盘小尺寸下清晰。
// 用法：go run scripts/gen_icon.go
package main

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
)

var (
	bodyBlue    = color.RGBA{0x2E, 0x86, 0xDE, 0xFF}
	bellyBlue   = color.RGBA{0x85, 0xC1, 0xE9, 0xFF}
	darkBlue    = color.RGBA{0x1A, 0x52, 0x76, 0xFF}
	white       = color.RGBA{0xFF, 0xFF, 0xFF, 0xFF}
	transparent = color.RGBA{0, 0, 0, 0}
)

// 基准 22x22 网格下的鲸鱼几何参数。
type shape struct {
	bodyCX, bodyCY, bodyRX, bodyRY float64 // 身体椭圆
	headCX, headCY, headR          float64 // 头部圆
	eyeCX, eyeCY, eyeR             float64 // 眼白
	pupilCX, pupilCY, pupilR       float64 // 瞳孔
	tailX0, tailY0, tailY1         float64 // 尾鳍顶点 (tailX0,44)-(64,28)-(64,56)
	bellyCX, bellyCY, bellyRX, bellyRY float64
}

var base = shape{
	bodyCX: 12, bodyCY: 12, bodyRX: 8.2, bodyRY: 4.6,
	headCX: 6.6, headCY: 12, headR: 3.8,
	eyeCX: 5.2, eyeCY: 10.6, eyeR: 1.3,
	pupilCX: 5.4, pupilCY: 10.7, pupilR: 0.65,
	tailX0: 16.5, tailY0: 7.5, tailY1: 16.5,
	bellyCX: 12, bellyCY: 13.6, bellyRX: 5.2, bellyRY: 2.0,
}

func inEllipse(x, y, cx, cy, rx, ry float64) bool {
	dx, dy := (x-cx)/rx, (y-cy)/ry
	return dx*dx+dy*dy <= 1
}

func inTail(x, y float64, s shape) bool {
	// 上鳍: (x0, midY)-(maxX, y0)-(maxX, midY)
	mid := (s.tailY0 + s.tailY1) / 2
	if y >= s.tailY0 && y <= mid && x >= s.tailX0 && x <= 22 {
		if y <= mid-(x-s.tailX0)*0.5 {
			return true
		}
	}
	// 下鳍
	if y >= mid && y <= s.tailY1 && x >= s.tailX0 && x <= 22 {
		if y >= mid+(x-s.tailX0)*0.5 {
			return true
		}
	}
	return false
}

func draw(size int, s shape) *image.RGBA {
	scale := float64(size) / 22.0
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			fx, fy := (float64(x)+0.5)/scale, (float64(y)+0.5)/scale
			c := transparent
			switch {
			case inTail(fx, fy, s):
				c = bodyBlue
			case inEllipse(fx, fy, s.bodyCX, s.bodyCY, s.bodyRX, s.bodyRY):
				if fy > s.bellyCY-1 && inEllipse(fx, fy, s.bellyCX, s.bellyCY, s.bellyRX, s.bellyRY) {
					c = bellyBlue
				} else {
					c = bodyBlue
				}
			case inEllipse(fx, fy, s.headCX, s.headCY, s.headR, s.headR):
				c = bodyBlue
			case inEllipse(fx, fy, s.eyeCX, s.eyeCY, s.eyeR, s.eyeR):
				c = white
			case math.Hypot(fx-s.pupilCX, fy-s.pupilCY) <= s.pupilR:
				c = darkBlue
			}
			img.Set(x, y, c)
		}
	}
	return img
}

func save(img *image.RGBA, path string) {
	f, err := os.Create(path)
	if err != nil {
		panic(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		panic(err)
	}
}

func main() {
	dir := "internal/icon"
	for _, size := range []int{22, 24, 32, 48, 64} {
		img := draw(size, base)
		save(img, filepath.Join(dir, fmt.Sprintf("whale-%d.png", size)))
	}
	// 64px 同时作为默认图标
	save(draw(64, base), filepath.Join(dir, "whale.png"))
	fmt.Println("written internal/icon/whale-{22,24,32,48,64}.png and whale.png")
}
