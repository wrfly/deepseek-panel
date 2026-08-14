// macOS 菜单栏托盘：NSStatusItem + NSMenu，运行在 Wails 的 NSApplication 主线程。
#import <Cocoa/Cocoa.h>
#include <string.h>

static NSStatusItem *g_statusItem = nil;
static NSMenu *g_menu = nil;

static void (*g_open)(void) = NULL;
static void (*g_settings)(void) = NULL;
static void (*g_usage)(void) = NULL;
static void (*g_quit)(void) = NULL;

@interface TrayTarget : NSObject
- (void)openClicked:(id)sender;
- (void)settingsClicked:(id)sender;
- (void)usageClicked:(id)sender;
- (void)quitClicked:(id)sender;
@end

@implementation TrayTarget
- (void)openClicked:(id)sender { if (g_open) g_open(); }
- (void)settingsClicked:(id)sender { if (g_settings) g_settings(); }
- (void)usageClicked:(id)sender { if (g_usage) g_usage(); }
- (void)quitClicked:(id)sender { if (g_quit) g_quit(); }
@end

static TrayTarget *g_target = nil;

static void trayDispatch(void (^block)(void)) {
    dispatch_async(dispatch_get_main_queue(), block);
}

void tray_start(const char *title, const char *tooltip) {
    // dispatch 是异步的，这里立即拷贝字符串，避免 Go 侧提前释放。
    char *titleCopy = strdup(title ? title : "");
    char *tooltipCopy = strdup(tooltip ? tooltip : "");
    trayDispatch(^{
        if (g_statusItem != nil) {
            free(titleCopy);
            free(tooltipCopy);
            return;
        }
        g_target = [[TrayTarget alloc] init];
        g_statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
        g_statusItem.button.title = [NSString stringWithUTF8String:titleCopy];
        g_statusItem.button.toolTip = [NSString stringWithUTF8String:tooltipCopy];
        g_menu = [[NSMenu alloc] init];
        [g_menu setAutoenablesItems:NO];

        NSMenuItem *openItem = [[NSMenuItem alloc] initWithTitle:@"打开面板"
                                                           action:@selector(openClicked:)
                                                    keyEquivalent:@""];
        openItem.target = g_target;
        [g_menu addItem:openItem];

        NSMenuItem *settingsItem = [[NSMenuItem alloc] initWithTitle:@"设置"
                                                              action:@selector(settingsClicked:)
                                                       keyEquivalent:@","];
        settingsItem.target = g_target;
        [g_menu addItem:settingsItem];

        [g_menu addItem:[NSMenuItem separatorItem]];

        NSMenuItem *usageItem = [[NSMenuItem alloc] initWithTitle:@"打开平台用量页"
                                                           action:@selector(usageClicked:)
                                                    keyEquivalent:@""];
        usageItem.target = g_target;
        [g_menu addItem:usageItem];

        [g_menu addItem:[NSMenuItem separatorItem]];

        NSMenuItem *quitItem = [[NSMenuItem alloc] initWithTitle:@"退出"
                                                          action:@selector(quitClicked:)
                                                   keyEquivalent:@"q"];
        quitItem.target = g_target;
        [g_menu addItem:quitItem];

        g_statusItem.menu = g_menu;
        free(titleCopy);
        free(tooltipCopy);
    });
}

void tray_set_text(const char *title, const char *tooltip) {
    char *titleCopy = strdup(title ? title : "");
    char *tooltipCopy = strdup(tooltip ? tooltip : "");
    trayDispatch(^{
        if (g_statusItem == nil) {
            free(titleCopy);
            free(tooltipCopy);
            return;
        }
        g_statusItem.button.title = [NSString stringWithUTF8String:titleCopy];
        g_statusItem.button.toolTip = [NSString stringWithUTF8String:tooltipCopy];
        free(titleCopy);
        free(tooltipCopy);
    });
}

void tray_stop(void) {
    trayDispatch(^{
        if (g_statusItem != nil) {
            [[NSStatusBar systemStatusBar] removeStatusItem:g_statusItem];
            g_statusItem = nil;
        }
        g_menu = nil;
    });
}