APP      := deepseek-panel
BUILD    := build
TAGS     := production webkit2_41

.PHONY: all build run dump install uninstall clean mac

all: build

## 构建当前平台（Linux 或 macOS）的可执行文件
build:
	go build -tags "$(TAGS)" -o $(BUILD)/$(APP) .

## 构建并运行（GUI）
run: build
	./$(BUILD)/$(APP)

## 无界面自测：拉取并打印余额/用量（设置 DEEPSEEK_PANEL_MOCK=1 可用离线模拟数据）
dump:
	go run -tags "$(TAGS)" . --dump

## 安装到系统（Linux：/usr/local/bin；macOS：/Applications/DeepSeekPanel.app）
install: build
	@if [ "$$(uname)" = "Darwin" ]; then \
		rm -rf /Applications/DeepSeekPanel.app && \
		mkdir -p /Applications/DeepSeekPanel.app/Contents/MacOS && \
		cp $(BUILD)/$(APP) /Applications/DeepSeekPanel.app/Contents/MacOS/ && \
		cp App/Info.plist /Applications/DeepSeekPanel.app/Contents/Info.plist && \
		codesign --force --deep -s - /Applications/DeepSeekPanel.app; \
	else \
		sudo install -m755 $(BUILD)/$(APP) /usr/local/bin/$(APP); \
	fi

uninstall:
	@if [ "$$(uname)" = "Darwin" ]; then \
		rm -rf /Applications/DeepSeekPanel.app; \
	else \
		sudo rm -f /usr/local/bin/$(APP); \
	fi

## macOS：构建 .app 包（需在 macOS 上执行）
mac:
	./scripts/build-mac.sh

## 清理
clean:
	rm -rf $(BUILD)
