.PHONY: build icon dump install run clean

build:
	./scripts/build.sh

icon:
	./scripts/gen_icon.sh

dump: build
	./dist/DeepSeekPanel.app/Contents/MacOS/DeepSeekPanel --dump

install: build
	ditto dist/DeepSeekPanel.app /Applications/DeepSeekPanel.app

run: build
	open dist/DeepSeekPanel.app

clean:
	rm -rf .build dist App/AppIcon.iconset App/icon-1024.png App/AppIcon.icns
