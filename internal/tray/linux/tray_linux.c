// Linux AppIndicator 托盘：通过 g_idle_add 把全部 GTK 调用调度到
// Wails 的 GTK 主循环（默认 main context），不启动额外事件循环。
#include <stdlib.h>
#include <string.h>
#include <libayatana-appindicator/app-indicator.h>
#include <gtk/gtk.h>

static AppIndicator *g_indicator = NULL;
static GtkMenu *g_menu = NULL;

extern void trayOpenClicked(void);
extern void traySettingsClicked(void);
extern void trayUsageClicked(void);
extern void trayQuitClicked(void);

typedef struct {
    char *icon_path;
    char *title;
    char *tooltip;
} StartData;

static GtkWidget *append_item(const char *label, GCallback cb) {
    GtkWidget *item = gtk_menu_item_new_with_label(label);
    g_signal_connect(item, "activate", cb, NULL);
    gtk_menu_shell_append(GTK_MENU_SHELL(g_menu), item);
    return item;
}

static gboolean do_start(gpointer data) {
    StartData *sd = (StartData *)data;
    g_menu = GTK_MENU(gtk_menu_new());
    append_item("打开面板", G_CALLBACK(trayOpenClicked));
    append_item("设置", G_CALLBACK(traySettingsClicked));
    gtk_menu_shell_append(GTK_MENU_SHELL(g_menu), gtk_separator_menu_item_new());
    append_item("打开平台用量页", G_CALLBACK(trayUsageClicked));
    gtk_menu_shell_append(GTK_MENU_SHELL(g_menu), gtk_separator_menu_item_new());
    append_item("退出", G_CALLBACK(trayQuitClicked));
    gtk_widget_show_all(GTK_WIDGET(g_menu));

    g_indicator = app_indicator_new("deepseek-panel", "deepseek-panel",
                                    APP_INDICATOR_CATEGORY_APPLICATION_STATUS);
    if (sd->icon_path && strlen(sd->icon_path) > 0) {
        app_indicator_set_icon_full(g_indicator, sd->icon_path, "DeepSeek");
    }
    const char *label = (sd->title && strlen(sd->title) > 0) ? sd->title : sd->tooltip;
    if (label && strlen(label) > 0) {
        app_indicator_set_title(g_indicator, label);
    }
    app_indicator_set_status(g_indicator, APP_INDICATOR_STATUS_ACTIVE);
    app_indicator_set_menu(g_indicator, GTK_MENU(g_menu));
    g_free(sd->icon_path);
    g_free(sd->title);
    g_free(sd->tooltip);
    g_free(sd);
    return G_SOURCE_REMOVE;
}

void tray_start(const char *icon_path, const char *title, const char *tooltip) {
    StartData *sd = g_new0(StartData, 1);
    sd->icon_path = g_strdup(icon_path ? icon_path : "");
    sd->title = g_strdup(title ? title : "");
    sd->tooltip = g_strdup(tooltip ? tooltip : "");
    g_idle_add(do_start, sd);
}

typedef struct {
    char *title;
    char *tooltip;
} TextData;

static gboolean do_set_text(gpointer data) {
    TextData *td = (TextData *)data;
    if (g_indicator != NULL) {
        if (td->title && strlen(td->title) > 0) {
            app_indicator_set_title(g_indicator, td->title);
        }
        if (td->tooltip && strlen(td->tooltip) > 0) {
            app_indicator_set_title(g_indicator, td->tooltip);
        }
    }
    g_free(td->title);
    g_free(td->tooltip);
    g_free(td);
    return G_SOURCE_REMOVE;
}

void tray_set_text(const char *title, const char *tooltip) {
    TextData *td = g_new0(TextData, 1);
    td->title = g_strdup(title ? title : "");
    td->tooltip = g_strdup(tooltip ? tooltip : "");
    g_idle_add(do_set_text, td);
}

static gboolean do_stop(gpointer data) {
    if (g_indicator != NULL) {
        app_indicator_set_status(g_indicator, APP_INDICATOR_STATUS_PASSIVE);
        g_object_unref(g_indicator);
        g_indicator = NULL;
    }
    if (g_menu != NULL) {
        g_object_unref(g_menu);
        g_menu = NULL;
    }
    return G_SOURCE_REMOVE;
}

void tray_stop(void) {
    g_idle_add(do_stop, NULL);
}