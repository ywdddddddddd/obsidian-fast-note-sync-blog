import { App, PluginSettingTab, Setting, Platform, SearchComponent, MarkdownRenderer, Component, requestUrl, Modal, setIcon, Notice, normalizePath } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import { unzipSync } from "fflate";

import { parseRules, SyncRule, getPluginDir, debounce, showSyncNotice, dump, dumpError } from "./lib/utils/helpers";
import { resetSettingSyncTime, rebuildAllHashes, clearAllHashes } from "./lib/sync/operator";
import { SettingsView, SupportView } from "./views/settings-view";
import { RuleEditorModal } from "./views/rule-editor-modal";
import { PathSuggestOptions } from "./views/path-suggest";
import { DebugLogModal } from "./views/debug-log-modal";
import { ConfirmModal } from "./views/confirm-modal";
import { ShareManageModal } from "./views/share-manage-modal";
import { AppWithInternal } from "./lib/utils/types";
import { RuleEditor } from "./views/rule-editor";
import { $ } from "./i18n/lang";
import type { BlogConfig } from "./lib/api/http_api_service";
import FastSync from "./main";
import { updateVaultName } from "./lib/settings/vault_name";

/**
 * 简历页骨架。
 *
 * 给一份能直接用的内容，而不是一个空文件：一篇带标记的空笔记渲染出来是一个空白页面，
 * 主人不知道该怎么写。三个容器各示范一次，他改字就行。
 *
 * 里面**没有任何真实个人信息**，只有占位符。自动生成的文件里写一个假名字，
 * 总会有人忘了改。
 */
const PAGE_SKELETON = `---
title: 关于我
page: about
avatar:
---

::: profile-head
**在这里写名字** · 一句话介绍
:::

## 经历

::: timeline
- 2019–2024  某某医院 住院医师
- 2024–        某某医院 主治医师
:::

## 找我

::: links
- 邮箱 mailto:you@example.com
- GitHub https://github.com/you
:::
`;



export interface PluginSettings {
  /** 是否启用同步（自动上传/下载） */
  syncEnabled: boolean
  /** 是否开启插件配置项同步 */
  configSyncEnabled: boolean
  /** 日志记录级别 ("off", "console", "internal") */
  logEnabled: "off" | "console" | "internal"
  /** API 基础地址 */
  api: string
  /** API 访问令牌 */
  apiToken: string
  /** 库（Vault）标识名称 */
  vault: string
  /** 启动同步延迟时间（毫秒），避免刚启动时大量 IO 冲突 */
  startupDelay: number
  /** 离线同步策略（如 newTimeMerge, ignoreTimeMerge 等） */
  offlineSyncStrategy: string
  /** 笔记/文件同步排除文件夹（每行一个） */
  syncExcludeFolders: string
  /** 笔记/文件同步排除扩展名（如 .tmp, .log） */
  syncExcludeExtensions: string
  /** 笔记/文件同步排除白名单（即使在排除文件夹内也强制同步） */
  syncExcludeWhitelist: string
  /** 是否启用 PDF 状态同步 */
  pdfSyncEnabled: boolean
  /** 是否启用云端预览功能（减少本地存储占用） */
  cloudPreviewEnabled: boolean
  /** 是否限制云端预览的文件类型 */
  cloudPreviewTypeRestricted: boolean
  /** 云端预览远程资源地址模板 */
  cloudPreviewRemoteUrl: string
  /** 云端预览上传后是否自动删除本地文件 */
  cloudPreviewAutoDeleteLocal: boolean
  /** 是否启用动态附件目录拼接（将 Ob 默认附件路径拼接到请求 path 中） */
  cloudPreviewDynamicAttachment: boolean
  /** 是否启用离线删除同步（本地删除后同步到服务端） */
  offlineDeleteSyncEnabled: boolean
  /** 同步更新延迟（毫秒），用于防抖处理 */
  syncUpdateDelay: number
  /** 是否在同步完成后显示通知 */
  isShowNotice: boolean
  /** 是否启用手动同步模式（禁用自动触发） */
  manualSyncEnabled: boolean
  /** 是否启用只读同步模式（不上传本地修改） */
  readonlySyncEnabled: boolean
  /** 远程服务调试地址（多行） */
  debugRemoteUrls: string
  /** 是否在菜单中显示版本信息 */
  showVersionInfo: boolean
  /** 配置同步 - 增加目录同步（多行） */
  configSyncOtherDirs: string
  /** 网络请求库类型 */
  networkLibrary: "fetch" | "requestUrl"
  /** 最小化自动暂停同步 */
  autoPauseMinimized: boolean
  /** 分享中的笔记路径缓存（vault-relative 格式）
   * Cache of actively shared note paths (vault-relative format) */
  sharedPaths: string[]
  /** 是否显示分享图标（原生文件管理器 & Notebook Navigator）
   * Whether to show share icon (native file explorer & Notebook Navigator) */
  showShareIcon: boolean
  /** 插件更新源 */
  updateSource: "github" | "cnb"
  /** 手机端状态点位置 */
  mobileStatusDotPosition: "hidden" | "top-right" | "top-left" | "bottom-right" | "bottom-left" | "menu-bar"
  /** 是否显示更新红点提示（侧边栏及图标） */
  showUpgradeBadge: boolean
  blockUpgrade: boolean
  /** 是否开启并发上传控制 (ACK 模式) */
  concurrencyControlEnabled: boolean
  /** 最大并发上传数量 */
  maxConcurrentUploads: number
  /** 是否在状态栏显示并发控制图标 */
  showConcurrencyIndicator: boolean
  /** 是否显示同步状态指示器（旋转图标）/ Whether to show sync status indicator (spinning icon) */
  showSyncIndicator: boolean
  /** 是否自动检测 API 跳转 (301/302) */
  autoRedirectEnabled: boolean
  /** 跳转服务地址(域名)允许清单 */
  allowedRedirectDomains: string
  /** 是否在WS连接前进行探测 */
  wsPreProbeEnabled: boolean
  /** 移动端消息通知距顶距离（px）/ Mobile toast top offset (px) */
  mobileToastTop: number
  /** 手机端失焦延迟暂停同步 / Mobile blur pause delay */
  mobileBlurPauseEnabled: boolean
  /** 是否启用 128MB 二进制文件同步限制 / Enable 128MB binary sync limit */
  binarySyncLimitEnabled: boolean
  /** 是否启用 Protobuf 协议进行消息同步 */
  protobufEnabled: boolean
  /** 笔记同步大小限制 (MB) / Note sync size limit (MB) */
  noteSyncLimit: number
  /** 附件同步大小限制 (MB) / Attachment sync size limit (MB) */
  attachmentSyncLimit: number
  /** 是否启用哈希计算数量限制 */
  hashSyncLimitEnabled: boolean
  /** 哈希计算数量限制 */
  hashSyncLimit: number
  /** 已提示过大文件跳过同步的 "path|size" 记录，避免同一文件每轮同步重复弹通知 */
  largeFileNoticeShown: string[]
}

/**
 *

![这是图片](https://markdown.com.cn/assets/img/philly-magic-garden.9c0b4415.jpg)

 */

// 默认插件设置
export const DEFAULT_SETTINGS: PluginSettings = {
  // 是否自动上传
  syncEnabled: true,
  configSyncEnabled: false,
  logEnabled: "off",
  // API 网关地址
  api: "",
  // API 令牌
  apiToken: "",
  vault: "",
  startupDelay: 500,
  offlineSyncStrategy: "",
  syncExcludeFolders: "",
  syncExcludeExtensions: "",
  syncExcludeWhitelist: "",
  pdfSyncEnabled: true,
  cloudPreviewEnabled: false,
  cloudPreviewTypeRestricted: true,
  cloudPreviewRemoteUrl: "",
  cloudPreviewAutoDeleteLocal: false,
  cloudPreviewDynamicAttachment: false,
  offlineDeleteSyncEnabled: false,
  syncUpdateDelay: 0,
  isShowNotice: true,
  manualSyncEnabled: false,
  readonlySyncEnabled: false,
  debugRemoteUrls: "",
  showVersionInfo: false,
  configSyncOtherDirs: "",
  networkLibrary: "requestUrl",
  autoPauseMinimized: false,
  sharedPaths: [],
  showShareIcon: true,
  updateSource: "github",
  mobileStatusDotPosition: "menu-bar",
  showUpgradeBadge: true,
  blockUpgrade: true,
  concurrencyControlEnabled: true,
  maxConcurrentUploads: 20,
  showConcurrencyIndicator: true,
  showSyncIndicator: false,
  autoRedirectEnabled: true,
  allowedRedirectDomains: "",
  wsPreProbeEnabled: true,
  // 手机 110，平板 126，与 CSS 硬编码值一致 / Phone 110, tablet 126, matches CSS defaults
  mobileToastTop: Platform.isTablet ? 126 : 110,
  mobileBlurPauseEnabled: true,
  binarySyncLimitEnabled: true,
  protobufEnabled: true,
  noteSyncLimit: 20,
  attachmentSyncLimit: 50,
  hashSyncLimitEnabled: false,
  hashSyncLimit: 50000,
  largeFileNoticeShown: [],
}

export type TabId = "GENERAL" | "DISPLAY" | "SHORTCUT" | "REMOTE" | "SYNC" | "CLOUD" | "BLOG" | "ASK" | "DEBUG"

// 预览 toast 位置，文案固定为 "Toast" / Preview toast position with fixed text "Toast"
function showTestToast(top: number) {
  const existing = activeDocument.querySelector(".fns-preview-toast")
  if (existing) existing.remove()
  const toast = activeDocument.body.createDiv()
  // 复用 .fns-mobile-toast 的样式，仅覆盖 top / Reuse .fns-mobile-toast styles, override top only
  toast.className = "fns-mobile-toast fns-preview-toast"
  toast.style.setProperty("--fns-toast-top-preview", `${top}px`)
  toast.textContent = "Toast"
  window.setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add("fns-mobile-toast-hiding")
      toast.addEventListener("animationend", () => toast.remove(), { once: true })
    }
  }, 2500)
}

export class SettingTab extends PluginSettingTab {
  plugin: FastSync
  roots: Root[] = []

  // 设置当前活动选项卡，默认为通用
  activeTab: TabId = "GENERAL"
  searchQuery: string = ""
  headerScrollLeft: number = 0

  // 缓存结构，避免频繁重绘导致卡顿
  private contentEl: HTMLElement | null = null
  private searchComponent: SearchComponent | null = null
  private lastViewMode: string = "" // 用于记录上次渲染的模式 (TabId 或 "SEARCH")

  private component: Component = new Component()

  constructor(app: App, plugin: FastSync) {
    super(app, plugin)
    this.plugin = plugin
  }

  getSettingDefinitions() {
    return []
  }

  hide(): void {
    this.roots.forEach((root) => root.unmount())
    this.roots = []
    this.component.unload()
  }

  refresh(): void {
    (this as unknown as { display(): void }).display();
  }

  display(): void {
    this.component.load()
    const { containerEl: set } = this

    // 记录当前的滚动位置 / Record current scroll position
    const savedScrollTop = set.scrollTop

    // 1. 初始化基础布局结构 (仅在首次或容器被清空时)
    const headerEl = set.querySelector(".fns-setting-tab-header") as HTMLElement
    const hasSearch = set.querySelector(".fns-setting-search-container")
    this.contentEl = set.querySelector(".fns-setting-tab-content")

    if (!headerEl || !hasSearch || !this.contentEl) {
      set.empty()
      this.unmountRoots()
      this.renderSearch(set)
      this.renderHeader(set)
      this.contentEl = set.createDiv("fns-setting-tab-content")
      this.lastViewMode = "" // 重置模式以强制重新渲染内容
    } else {
      // 如果结构已存在，则同步更新 Header 的选中状态 (避免 Tab 无法切换的视觉错觉)
      this.updateHeaderSelection(headerEl)
    }

    const contentEl = this.contentEl

    // 2. 移动端滑动监听 (如果 contentEl 是新建的，需要重新挂载)
    if (Platform.isMobile && !contentEl.hasAttribute("data-swipe-init")) {
      contentEl.setAttribute("data-swipe-init", "true")
      let touchStartX = 0
      let touchStartY = 0
      contentEl.addEventListener(
        "touchstart",
        (e) => {
          touchStartX = e.changedTouches[0].screenX
          touchStartY = e.changedTouches[0].screenY
        },
        { passive: true },
      )

      contentEl.addEventListener(
        "touchend",
        (e) => {
          const touchEndX = e.changedTouches[0].screenX
          const touchEndY = e.changedTouches[0].screenY
          this.handleSwipe(touchStartX, touchStartY, touchEndX, touchEndY)
        },
        { passive: true },
      )
    }

    // 3. 根据搜索状态或标签页渲染内容
    const currentMode = this.searchQuery ? "SEARCH" : this.activeTab

    // 关键修正：每次 display 时都清空并重新渲染，除非是在极高频的搜索过滤中
    // 之前因为判断 lastViewMode 导致重新打开窗口时内容为空
    contentEl.empty()
    this.unmountRoots()

    if (this.searchQuery) {
      this.renderAllSettings(contentEl)
    } else {
      switch (this.activeTab) {
        case "GENERAL":
          this.renderGeneralSettings(contentEl)
          break
        case "DEBUG":
          this.renderDebugSettings(contentEl)
          break
        case "REMOTE":
          this.renderRemoteSettings(contentEl)
          break
        case "SYNC":
          this.renderSyncSettings(contentEl)
          break
        case "CLOUD":
          this.renderCloudSettings(contentEl)
          break
        case "DISPLAY":
          this.renderDisplaySettings(contentEl)
          break
        case "SHORTCUT":
          this.renderShortcutSettings(contentEl)
          break
        case "BLOG":
          this.renderBlogSettings(contentEl)
          break
        case "ASK":
          this.renderBlogAskSettings(contentEl)
          break
      }
    }
    this.lastViewMode = currentMode

    // 4. 执行搜索过滤 (如果是搜索模式)
    if (this.searchQuery) {
      this.applySearchFilter(contentEl)
    }

    // 还原滚动位置 / Restore scroll position
    set.scrollTop = savedScrollTop
    window.requestAnimationFrame(() => {
      set.scrollTop = savedScrollTop
    })
  }

  private updateHeaderSelection(headerEl: HTMLElement) {
    const tabs = headerEl.querySelectorAll(".fns-setting-tab-item")
    tabs.forEach((tabEl) => {
      const el = tabEl as HTMLElement
      if (el.dataset.tabId === this.activeTab && !this.searchQuery) {
        el.addClass("is-active")
        // 确保选中的 Tab 可见
        el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" })
      } else {
        el.removeClass("is-active")
      }
    })
  }

  private unmountRoots() {
    this.roots.forEach((root) => {
      try {
        root.unmount()
      } catch {
        /* ignore */
      }
    })
    this.roots = []
  }

  private handleSwipe(startX: number, startY: number, endX: number, endY: number) {
    const deltaX = endX - startX
    const deltaY = endY - startY
    const threshold = 50

    if (Math.abs(deltaX) > threshold && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      const tabs: TabId[] = ["GENERAL", "DISPLAY", "REMOTE", "SYNC", "SHORTCUT", "CLOUD", "BLOG", "ASK", "DEBUG"]
      const currentIndex = tabs.indexOf(this.activeTab)

      if (deltaX > 0) {
        // Swipe right -> Previous tab
        if (currentIndex > 0) {
          this.activeTab = tabs[currentIndex - 1]
          this.refresh()
        }
      } else {
        // Swipe left -> Next tab
        if (currentIndex < tabs.length - 1) {
          this.activeTab = tabs[currentIndex + 1]
          this.refresh()
        }
      }
    }
  }

  private renderSearch(containerEl: HTMLElement) {
    const searchContainer = containerEl.createDiv("fns-setting-search-container")
    const search = new SearchComponent(searchContainer).setPlaceholder($("setting.search.placeholder")).setValue(this.searchQuery)

    this.searchComponent = search

    // 优化：使用防抖减少重绘，并提高响应速度 (从 500ms 默认降低到 150ms)
    const debouncedApply = debounce(() => {
      this.refresh()
    }, 150)

    search.onChange((value) => {
      this.searchQuery = value
      debouncedApply()
    })
  }

  private renderAllSettings(contentEl: HTMLElement) {
    this.renderGeneralSettings(contentEl)
    this.renderDisplaySettings(contentEl)
    this.renderRemoteSettings(contentEl)
    this.renderSyncSettings(contentEl)
    this.renderShortcutSettings(contentEl)
    this.renderCloudSettings(contentEl)
    this.renderBlogSettings(contentEl)
    this.renderDebugSettings(contentEl)
  }

  private applySearchFilter(containerEl: HTMLElement) {
    const query = this.searchQuery.toLowerCase()
    const children = Array.from(containerEl.children) as HTMLElement[]
    let hasVisibleItem = false

    // 1. 第一阶段：处理所有非标题项的显示隐藏
    children.forEach((item) => {
      // 标题栏在第二阶段处理
      if (item.classList.contains("setting-item-heading")) return

      // 对于普通的 setting-item，检查名称和描述
      const name = item.querySelector(".setting-item-name")?.textContent?.toLowerCase() || ""
      const desc = item.querySelector(".setting-item-description")?.textContent?.toLowerCase() || ""
      // 对于其他 div (如 React 渲染的容器)，检查其整体文本内容
      const otherText = item.classList.contains("setting-item") ? "" : item.textContent?.toLowerCase() || ""

      if (name.includes(query) || desc.includes(query) || otherText.includes(query)) {
        item.removeClass("fns-hidden")
        hasVisibleItem = true
      } else {
        item.addClass("fns-hidden")
      }
    })

    // 2. 第二阶段：根据后续项的显示状态来决定标题栏是否显示
    children.forEach((item, index) => {
      if (!item.classList.contains("setting-item-heading")) return

      let shouldShow = false
      // 向后搜索，直到遇到下一个标题栏或容器末尾
      for (let i = index + 1; i < children.length; i++) {
        const next = children[i]
        if (next.classList.contains("setting-item-heading")) break
        if (!next.classList.contains("fns-hidden")) {
          shouldShow = true
          break
        }
      }
      if (shouldShow) {
        item.removeClass("fns-hidden")
      } else {
        item.addClass("fns-hidden")
      }
    })

    // 3. 处理 "No results" 消息
    containerEl.querySelectorAll(".fns-setting-no-results").forEach((el) => el.remove())

    if (!hasVisibleItem) {
      containerEl.createDiv("fns-setting-no-results").setText("No results found.")
    }
  }

  private renderHeader(containerEl: HTMLElement) {
    const headerEl = containerEl.createDiv("fns-setting-tab-header")

    const tabs: { id: TabId; label: string }[] = [
      { id: "GENERAL", label: $("setting.tab.general") },
      { id: "DISPLAY", label: $("setting.tab.display") },
      { id: "REMOTE", label: $("setting.tab.remote") },
      { id: "SYNC", label: $("setting.tab.sync") },
      { id: "SHORTCUT", label: $("setting.tab.shortcut") },
      { id: "CLOUD", label: $("setting.tab.cloud") },
      { id: "BLOG", label: $("setting.tab.blog") },
      { id: "ASK", label: $("setting.tab.ask") },
      { id: "DEBUG", label: $("setting.tab.debug") },
    ]

    let activeTabEl: HTMLElement | null = null

    tabs.forEach((tab) => {
      const tabEl = headerEl.createDiv("fns-setting-tab-item")
      tabEl.setText(tab.label)
      tabEl.dataset.tabId = tab.id // 设置标识用于后续更新状态
      if (this.activeTab === tab.id) {
        tabEl.addClass("is-active")
        activeTabEl = tabEl
      }
      tabEl.onclick = () => {
        this.searchQuery = "" // 切换标签时清空搜索
        if (this.searchComponent) this.searchComponent.setValue("")
        this.activeTab = tab.id
        this.refresh()
      }
    })

    headerEl.scrollLeft = this.headerScrollLeft
    headerEl.onscroll = () => {
      this.headerScrollLeft = headerEl.scrollLeft
    }

    if (activeTabEl) {
      window.requestAnimationFrame(() => {
        if (!activeTabEl) return
        activeTabEl.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" })
      })
    }
  }

  private renderGeneralSettings(set: HTMLElement) {
    new Setting(set).setName($("setting.sync.startup_delay")).addText((text) =>
      text
        .setPlaceholder($("setting.sync.startup_delay_placeholder"))
        .setValue(this.plugin.settings.startupDelay.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value)
          if (!isNaN(numValue) && numValue >= 0) {
            this.plugin.settings.startupDelay = numValue
            await this.plugin.saveAndReloadServices()
          }
        }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.sync.startup_delay_desc"))

    new Setting(set).setName($("setting.debug.update_source")).addDropdown((dropdown) =>
      dropdown
        .addOption("github", "GitHub")
        .addOption("cnb", "腾讯 cnb")
        .setValue(this.plugin.settings.updateSource || "github")
        .onChange(async (value: "github" | "cnb") => {
          this.plugin.settings.updateSource = value
          await this.plugin.saveAndReloadServices()
        }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.debug.update_source_desc"))

    new Setting(set).setName($("setting.support.title")).setHeading().setClass("fast-note-sync-settings-tag")

    const supportSet = set.createDiv()
    const root = createRoot(supportSet)
    this.roots.push(root)
    root.render(<SupportView plugin={this.plugin} />)

    this.renderDebugTools(set, true)
  }

  private getDebugInfo(): string {
    // 单个 URL 的脱敏：保留协议与端口，host 仅保留首尾字符
    // Mask a single URL: keep protocol and port, replace host middle with ***
    const maskValue = (val: string) => {
      if (!val) return ""
      const parts = val.split("://")
      const protocol = parts.length > 1 ? parts[0] + "://" : ""
      const address = parts.length > 1 ? parts[1] : parts[0]

      const lastColonIndex = address.lastIndexOf(":")
      let port = ""
      let host = address
      if (lastColonIndex !== -1 && !address.includes("/", lastColonIndex)) {
        host = address.slice(0, lastColonIndex)
        port = address.slice(lastColonIndex)
      }

      let maskedHost = host
      if (host.length > 4) {
        maskedHost = host[0] + "***" + host.slice(-1)
      } else if (host.length > 0) {
        maskedHost = host[0] + "***"
      }

      return protocol + maskedHost + port
    }

    // 多行 URL 字段逐行脱敏，保留非 URL 行原样
    // Mask multi-line URL fields line-by-line, leaving non-URL lines untouched
    const maskMultiline = (val: string) => {
      if (!val.includes("\n")) return maskValue(val)
      return val
        .split("\n")
        .map((line) => (line.includes("://") ? maskValue(line) : line))
        .join("\n")
    }

    // 兜底敏感扫描：在显式脱敏之外，递归扫描整个 debug 对象
    // - 键名命中 SECRET_KEY_RE 的字符串字段：整体替换为 ***HIDDEN***
    // - 键名命中 URL_KEY_RE 且值含 "://" 的字符串字段：用 maskValue 脱敏
    // 目的：当 PluginSettings 新增字段、或老版本残留字段出现时，即使忘记在显式列表里添加脱敏，也能自动覆盖。
    // Defense-in-depth: recursive sanitize as a safety net beyond explicit masking.
    const SECRET_KEY_RE = /token|secret|password|passphrase|credential|apikey/i
    const URL_KEY_RE = /api|url|endpoint|gateway|host|origin/i
    const sanitize = (node: unknown): unknown => {
      if (Array.isArray(node)) return node.map(sanitize)
      if (node && typeof node === "object") {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          if (typeof v === "string" && v.length > 0) {
            if (SECRET_KEY_RE.test(k)) {
              out[k] = "***HIDDEN***"
            } else if (URL_KEY_RE.test(k) && v.includes("://")) {
              out[k] = maskMultiline(v)
            } else {
              out[k] = v
            }
          } else {
            out[k] = sanitize(v)
          }
        }
        return out
      }
      return node
    }

    const safeProcess = (typeof process !== "undefined" ? process : undefined) as unknown as {
      platform?: string;
      arch?: string;
      versions?: {
        node?: string;
        electron?: string;
        chrome?: string;
        v8?: string;
      };
    } | undefined;

    // debug信息，显式脱敏作为主防线
    // debugInfo, Explicit masking is the primary line
    const debugInfo = {
      settings: {
        ...this.plugin.settings,
        api: maskValue(this.plugin.settings.api),
        apiToken: this.plugin.settings.apiToken ? "***HIDDEN***" : "",
      },
      runtimeInfo: {
        runApi: maskValue(this.plugin.runApi),
        runWsApi: maskValue(this.plugin.runWsApi),
        isInitSync: this.plugin.localStorageManager.getMetadata("isInitSync"),
        lastNoteSyncTime: this.plugin.localStorageManager.getMetadata("lastNoteSyncTime"),
        lastFileSyncTime: this.plugin.localStorageManager.getMetadata("lastFileSyncTime"),
        lastConfigSyncTime: this.plugin.localStorageManager.getMetadata("lastConfigSyncTime"),
        clientName: this.plugin.localStorageManager.getMetadata("clientName"),

        serverConnectionStatus: this.plugin.websocket.isConnected() ? "connected" : "disconnected",
        ...(this.plugin.websocket.isConnected()
          ? {
            serverVersion: this.plugin.localStorageManager.getMetadata("serverVersion"),
          }
          : {
            serverLastConnectVersion: this.plugin.localStorageManager.getMetadata("serverVersion"),
          }),

        serverVersionIsNew: this.plugin.versionManager.isServerNew(),
        pluginVersionIsNew: this.plugin.versionManager.isPluginNew(),
      },
      systemInfo: {
        isDesktop: Platform.isDesktopApp,
        isMobile: Platform.isMobile,
        isTablet: Platform.isTablet,
        platform: safeProcess?.platform ?? "unknown",
        arch: safeProcess?.arch ?? "unknown",
        userAgent: "Obsidian/" + ((this.app as unknown as { version: string }).version || "unknown"),
        versions: safeProcess?.versions
          ? {
              node: safeProcess.versions.node,
              electron: safeProcess.versions.electron,
              chrome: safeProcess.versions.chrome,
              v8: safeProcess.versions.v8,
            }
          : {},
        capacitor: (window as unknown as { Capacitor: { getPlatform(): string; isNative: boolean } }).Capacitor
          ? {
            platform: (window as unknown as { Capacitor: { getPlatform(): string; isNative: boolean } }).Capacitor.getPlatform(),
            isNative: (window as unknown as { Capacitor: { getPlatform(): string; isNative: boolean } }).Capacitor.isNative,
          }
          : "not found",
        obsidianVersion: (this.app as unknown as { version: string }).version || "unknown",
      },
      pluginVersion: this.plugin.manifest.version,
    }
    // sanitize 兜底敏感扫描作为次防线，避免遗漏任何敏感信息
    // sanitize as a secondary line to catch any missed sensitive info
    return JSON.stringify(sanitize(debugInfo), null, 4)
  }

  private renderDebugTools(set: HTMLElement, isHomePage: boolean = false) {
    const debugItem = set.createDiv("setting-item")
    const info = debugItem.createDiv("setting-item-info")
    const desc = info.createDiv("setting-item-description")

    const debugDiv = desc.createDiv("fast-note-sync-settings-debug")

    const debugButton = debugDiv.createEl("button")
    debugButton.setText($("setting.support.debug_copy"))
    debugButton.onclick = async () => {
      try {
        await navigator.clipboard.writeText(this.getDebugInfo())
        showSyncNotice($("setting.support.debug_desc"))
      } catch (e) {
        console.error("[fast-note-sync] copy debug info failed:", e)
        // TODO(i18n): replace with localized key, e.g. $("setting.support.debug_copy_failed")
        showSyncNotice("Failed to copy debug info.")
      }
    }

    if (isHomePage) {
      const issueButton = debugDiv.createEl("button")
      issueButton.setText($("setting.support.issue"))
      issueButton.onclick = async () => {
        try {
          await navigator.clipboard.writeText(this.getDebugInfo())
          showSyncNotice($("setting.support.debug_desc"))
        } catch (e) {
          console.error("[fast-note-sync] copy debug info failed:", e)
          // TODO(i18n): replace with localized key, e.g. $("setting.support.debug_copy_failed")
          showSyncNotice("Failed to copy debug info.")
        }
        new ConfirmModal(
          this.app,
          $("ui.title.notice"),
          $("setting.support.issue_notice"),
          () => {
            window.open("https://github.com/haierkeys/obsidian-fast-note-sync/issues", "_blank")
          },
          $("ui.button.goto_feedback"),
          $("ui.button.cancel"),
          false,
        ).open()
      }

      const featureButton = debugDiv.createEl("button")
      featureButton.setText($("setting.support.feature"))
      featureButton.onclick = () => {
        window.open("https://github.com/haierkeys/obsidian-fast-note-sync/issues", "_blank")
      }

      const telegramButton = debugDiv.createEl("button")
      telegramButton.setText($("setting.support.telegram"))
      telegramButton.onclick = () => {
        window.open("https://t.me/obsidian_users", "_blank")
      }

      const logViewButton = debugDiv.createEl("button")
      logViewButton.setText($("ui.log.view_log"))
      logViewButton.onclick = () => {
        void this.plugin.activateLogView()
      }
    } else {
      const clearCacheButton = debugDiv.createEl("button")
      clearCacheButton.setText($("ui.menu.clear_cache"))
      clearCacheButton.onclick = () => {
        new ConfirmModal(
          this.app,
          $("ui.title.notice"),
          $("setting.debug.clear_cache_confirm"),
          () => {
            void (async () => {
              await resetSettingSyncTime(this.plugin, true)
              await clearAllHashes(this.plugin)
              showSyncNotice($("setting.debug.clear_cache_success"))
            })()
          },
          $("ui.button.confirm"),
          $("ui.button.cancel"),
          false,
        ).open()
      }

      const clearHashButton = debugDiv.createEl("button")
      clearHashButton.setText($("ui.menu.rebuild_hash"))
      clearHashButton.onclick = () => {
        new ConfirmModal(
          this.app,
          $("ui.title.notice"),
          $("setting.debug.clear_hash_desc"),
          () => {
            void rebuildAllHashes(this.plugin)
          },
          $("ui.button.confirm"),
          $("ui.button.cancel"),
          false,
        ).open()
      }

      const installButton = debugDiv.createEl("button")
      installButton.setText($("setting.debug.version_install_title") || "指定版本安装")
      installButton.onclick = () => {
        new InputModal(
          this.app,
          $("setting.debug.version_install_title") || "指定版本安装",
          $("setting.debug.version_install_desc") || "直接绕开远端服务下载并覆盖安装指定版本的插件。",
          "例如: 2.0.12",
          (val) => {
            void this.startVersionInstall(val, installButton)
          }
        ).open()
      }

      const resetAllButton = debugDiv.createEl("button")
      resetAllButton.addClass("mod-cta", "fns-white-text")
      resetAllButton.setText($("setting.debug.reset_all"))
      resetAllButton.onclick = () => {
        new ConfirmModal(
          this.app,
          $("setting.debug.reset_all"),
          $("setting.debug.reset_all_desc"),
          () => {
            void (async () => {
              // 先运行远端配置清理逻辑
              if (this.plugin.settings.configSyncEnabled) {
                this.plugin.isWaitClearSync = true
              }
              void this.plugin.websocket.SendMessage("SettingClear", {
                vault: this.plugin.settings.vault,
              }).catch(e => dumpError(e))

              // 备份需要保留的远端核心配置
              const backup = {
                api: this.plugin.settings.api,
                apiToken: this.plugin.settings.apiToken,
                vault: this.plugin.settings.vault,
                debugRemoteUrls: this.plugin.settings.debugRemoteUrls,
                networkLibrary: this.plugin.settings.networkLibrary,
              }
              // 备份客户端名称（元数据）
              const clientNameBackup = this.plugin.localStorageManager.getMetadata("clientName")

              // 重置 settings 为默认值
              this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS)

              // 恢复备份的远端设置
              this.plugin.settings.api = backup.api
              this.plugin.settings.apiToken = backup.apiToken
              this.plugin.settings.vault = backup.vault
              this.plugin.settings.debugRemoteUrls = backup.debugRemoteUrls
              this.plugin.settings.networkLibrary = backup.networkLibrary

              // 重新初始化某些依赖库路径的动态默认值
              // Reinitialize dynamic default values for certain dependency library paths
              const defaultExcludes = [
                `${getPluginDir(this.plugin)}/data.json`,
                `${getPluginDir(this.plugin)}/configHashMap.json`,
                `${getPluginDir(this.plugin)}/fileHashMap.json`,
                `${getPluginDir(this.plugin)}/folderSnapshot.json`,
                `${this.app.vault.configDir}/community-plugins.json`,
              ]
              this.plugin.settings.syncExcludeFolders = JSON.stringify(defaultExcludes.map((pattern) => ({ pattern, caseSensitive: false })))

              // 确保客户端名称不被重置
              if (clientNameBackup) {
                this.plugin.localStorageManager.setMetadata("clientName", clientNameBackup)
              }

              // 深度清理：同步时间记录 + 哈希表
              await resetSettingSyncTime(this.plugin)
              await rebuildAllHashes(this.plugin)

              // 保存设置
              await this.plugin.saveAndReloadServices()

              showSyncNotice($("setting.debug.reset_all_success"))

              // 重新渲染设置页面以展示变化
              this.refresh()
            })();
          },
          $("ui.button.confirm"),
          $("ui.button.cancel"),
          false,
        ).open()
      }
    }

    if (Platform.isDesktopApp) {
      const info = debugDiv.createDiv()
      info.setText($("setting.support.console_tip"))

      const keys = debugDiv.createDiv()
      keys.addClass("custom-shortcuts")
      if (Platform.isMacOS === true) {
        keys.createEl("kbd", { text: $("setting.support.console_mac") })
      } else {
        keys.createEl("kbd", { text: $("setting.support.console_win") })
      }
    }
  }

  private renderDebugSettings(set: HTMLElement) {
    new Setting(set).setName($("setting.support.log")).addDropdown((dropdown) =>
      dropdown
        .addOption("off", $("setting.support.log_off"))
        .addOption("console", $("setting.support.log_console"))
        .addOption("internal", $("setting.support.log_internal"))
        .setValue(this.plugin.settings.logEnabled || "off")
        .onChange(async (value: "off" | "console" | "internal") => {
          this.plugin.settings.logEnabled = value
          await this.plugin.saveAndReloadServices()
          this.refresh() // 重新渲染以更新按钮显示状态
        }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.support.log_desc"))

    if (this.plugin.settings.logEnabled === "internal") {
      new Setting(set).setName($("setting.support.log_view")).addButton((btn) =>
        btn.setButtonText($("setting.support.log_view")).onClick(() => {
          new DebugLogModal(this.app).open()
        }),
      )
    }

    new Setting(set).setName($("setting.debug.network_library")).addDropdown((dropdown) =>
      dropdown
        .addOption("fetch", "Fetch")
        .addOption("requestUrl", "Request URL")
        .setValue(this.plugin.settings.networkLibrary)
        .onChange(async (value: "fetch" | "requestUrl") => {
          this.plugin.settings.networkLibrary = value
          await this.plugin.saveAndReloadServices()
        }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.debug.network_library_desc"))

    new Setting(set).setName($("setting.support.debug_url")).addTextArea((text) =>
      text
        .setPlaceholder("http://192.168.1.100:8080\nhttp://debug.example.com")
        .setValue(this.plugin.settings.debugRemoteUrls)
        .onChange(async (value) => {
          this.plugin.settings.debugRemoteUrls = value
          await this.plugin.saveAndReloadServices()
        }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.support.debug_url_desc"))

    new Setting(set).setName($("setting.debug.protobuf")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.protobufEnabled !== false).onChange(async (value) => {
        this.plugin.settings.protobufEnabled = value
        await this.plugin.saveAndReloadServices()
        // Send updated ClientInfo immediately to sync protocol change to the server
        // 立即发送更新后的 ClientInfo 以便向服务端同步协议变更
        this.plugin.websocket?.sendClientInfo()
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.debug.protobuf_desc"))

    new Setting(set)
      .setName($("setting.sync.clear_remote"))
      .setDesc($("setting.sync.clear_remote_desc"))
      .setClass("fns-setting-item-vertical")
      .addButton((btn) => {
        const destBtn = btn as unknown as { setDestructive(): void };
        if (typeof destBtn.setDestructive === "function") {
          destBtn.setDestructive();
        } else {
          const legacyBtn = btn as unknown as { setWarning(): void };
          legacyBtn.setWarning();
        }
        btn
          .setButtonText($("setting.sync.clear_remote"))
          .onClick(async () => {
            new ConfirmModal(this.app, $("setting.sync.clear_remote"), $("setting.sync.clear_remote_confirm"), () => {
              if (this.plugin.settings.configSyncEnabled) {
                this.plugin.isWaitClearSync = true
              }
              void this.plugin.websocket.SendMessage("SettingClear", {
                vault: this.plugin.settings.vault,
              })

              btn.setDisabled(true)
              btn.setIcon("check")
              window.setTimeout(() => {
                btn.setDisabled(false)
                btn.setIcon("")
                btn.setButtonText($("setting.sync.clear_remote"))
              }, 5000)
            }).open()
          })
      })

    this.renderDebugTools(set, false)
  }

  /**
   * 下载、解压并覆盖安装指定版本的插件，并在完成后安全热重载插件
   * Download, unzip and overwrite install a specific version of the plugin, and safely hot-reload the plugin upon completion
   */
  private async startVersionInstall(inputVersion: string, btn: HTMLButtonElement) {
    dump("[fast-note-sync] startVersionInstall called with input:", inputVersion);
    let latest = inputVersion.trim();
    if (!latest) {
      showSyncNotice($("setting.debug.version_install_empty") || "请输入要安装的版本号");
      dump("[fast-note-sync] version input is empty");
      return;
    }

    // 1. 剥离可能存在的 'v' 或 'V' 前缀 / Strip possible 'v' or 'V' prefix
    if (latest.startsWith("v") || latest.startsWith("V")) {
      latest = latest.substring(1);
    }
    dump("[fast-note-sync] sanitized version input:", latest);

    // 2. 严格的 x.x.x 格式正则表达式校验 / Strict regex validation for x.x.x format
    const versionRegex = /^\d+\.\d+\.\d+$/;
    if (!versionRegex.test(latest)) {
      showSyncNotice($("setting.debug.version_install_invalid") || "版本号格式错误，必须为 x.x.x 格式（例如: 2.0.12）");
      dump("[fast-note-sync] version format check failed:", latest);
      return;
    }

    const tag = "v" + latest;
    const confirmMsg = ($("setting.debug.version_install_confirm") || "确认要从更新源下载并覆盖安装版本为 ${version} 的插件吗？").replace("${version}", tag);

    dump("[fast-note-sync] opening ConfirmModal for tag:", tag);
    new ConfirmModal(
      this.app,
      $("ui.title.notice"),
      confirmMsg,
      () => {
        void (async () => {
          dump("[fast-note-sync] ConfirmModal confirmed. Disabling button...");

          btn.disabled = true;
          const originalText = btn.textContent || "";
          dump("[fast-note-sync] original button text:", originalText);
          btn.textContent = $("setting.debug.version_installing") || "正在安装...";

          try {
            const source = this.plugin.settings.updateSource || "github";
            const zipFileName = `fast-note-sync-v${latest}.zip`;
            const pluginDir = getPluginDir(this.plugin);

            let url = "";
            if (source === "github") {
              url = `https://github.com/haierkeys/obsidian-fast-note-sync/releases/download/${latest}/${zipFileName}`;
            } else {
              // CNB 链接格式：releases/download/{version}/fast-note-sync-v{version}.zip
              url = `https://cnb.cool/haierkeys/obsidian-fast-note-sync/-/releases/download/${latest}/${zipFileName}`;
            }

            dump(`[fast-note-sync] preparing download. Source: ${source}, Tag: ${tag}, Zip: ${zipFileName}, Dir: ${pluginDir}, URL: ${url}`);
            showSyncNotice($("ui.version.downloading_file", { file: zipFileName }) || `正在下载 ${zipFileName}...`);

            // 3. 跨域下载 Zip 包 / Download zip with requestUrl to bypass CORS and gain speed
            dump("[fast-note-sync] initiating requestUrl request to:", url);
            const response = await requestUrl({
              url: url,
              method: "GET",
            });

            dump("[fast-note-sync] requestUrl returned. status:", response.status);
            if (response.status !== 200) {
              throw new Error(`Failed to download ${zipFileName}: ${response.status}`);
            }

            showSyncNotice("下载成功，正在解密与提取文件...");
            const arrayBuffer = response.arrayBuffer;
            dump("[fast-note-sync] arrayBuffer loaded. size in bytes:", arrayBuffer.byteLength);

            dump("[fast-note-sync] unzipping file contents with fflate...");
            const unzipped: Record<string, Uint8Array> = unzipSync(new Uint8Array(arrayBuffer));
            dump("[fast-note-sync] unzip completed. Total items in zip:", Object.keys(unzipped).length);

            // 4. 自动检测根目录前缀（寻找 manifest.json 所在位置） / Automatically detect root prefix in zip
            let rootPrefix = "";
            const fileNames = Object.keys(unzipped);
            const manifestFile = fileNames.find((f) => f.endsWith("manifest.json"));
            if (manifestFile) {
              rootPrefix = manifestFile.replace("manifest.json", "");
            }
            dump("[fast-note-sync] zip root prefix detected:", rootPrefix || "(none)");

            const files = Object.entries(unzipped).filter(([name]) => !name.endsWith("/") && name.startsWith(rootPrefix));
            dump("[fast-note-sync] total files filtered to extract:", files.length);

            // 5. 递归解压并覆盖写入 / Extract and overwrite recursively
            let count = 0;
            for (const [realFilename, content] of files) {
              const relativeFilename = realFilename.substring(rootPrefix.length);
              if (!relativeFilename) continue;

              const path = `${pluginDir}/${relativeFilename}`;
              dump(`[fast-note-sync] extracting file [${++count}/${files.length}]: ${relativeFilename} -> ${path}`);

              // 确保父目录存在 / Ensure parent directory exists
              const pathParts = relativeFilename.split("/");
              if (pathParts.length > 1) {
                let currentPath = pluginDir;
                for (let i = 0; i < pathParts.length - 1; i++) {
                  currentPath += `/${pathParts[i]}`;
                  if (!(await this.plugin.app.vault.adapter.exists(currentPath))) {
                    dump(`[fast-note-sync] creating directory: ${currentPath}`);
                    await this.plugin.app.vault.adapter.mkdir(currentPath);
                  }
                }
              }

              dump(`[fast-note-sync] writing binary data to: ${path}`);
              await this.plugin.app.vault.adapter.writeBinary(path, content.buffer as ArrayBuffer);
            }
            dump("[fast-note-sync] all files successfully extracted and written to filesystem.");

            // 6. 热重载插件 / Hot reload plugin
            showSyncNotice($("setting.debug.version_installing_notice") || "正在安装指定版本插件...");
            dump("[fast-note-sync] initiating plugin hot reload...");

            const app = this.app as AppWithInternal;
            const plugins = app.plugins;
            if (!plugins) {
              throw new Error("Cannot find plugin manager.");
            }

            const id = this.plugin.manifest.id;
            dump("[fast-note-sync] target plugin ID to reload:", id);

            await new Promise((resolve) => window.setTimeout(resolve, 500));

            dump("[fast-note-sync] disabling plugin...");
            await plugins.disablePlugin(id);
            dump("[fast-note-sync] loading plugin manifests...");
            await plugins.loadManifests();
            dump("[fast-note-sync] enabling plugin...");
            await plugins.enablePlugin(id);

            dump("[fast-note-sync] hot reload finished successfully.");
            showSyncNotice($("setting.debug.version_install_success") || "插件安装并重载成功", 10000);
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            dumpError("[fast-note-sync] manual version install failed with error:", e);
            showSyncNotice(($("setting.debug.version_install_fail") || "插件安装失败") + ": " + errorMsg);
          } finally {
            dump("[fast-note-sync] startVersionInstall execution completed. Restoring button state.");
            btn.disabled = false;
            btn.textContent = originalText || "开始安装";
          }
        })();
      },
      $("ui.button.confirm"),
      $("ui.button.cancel"),
      false,
    ).open();
  }

  private renderDisplaySettings(set: HTMLElement) {
    new Setting(set).setName($("setting.general.show_notice")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.isShowNotice).onChange(async (value) => {
        if (value != this.plugin.settings.isShowNotice) {
          this.plugin.settings.isShowNotice = value
          await this.plugin.saveAndReloadServices()
          this.refresh()
        }
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.general.show_notice_desc"))

    // 仅移动端且通知开启时显示子选项 / Show sub-option only on mobile with notifications enabled
    if (Platform.isMobile && this.plugin.settings.isShowNotice) {
      // 用闭包保存 TextComponent，供测试按钮读取当前输入值 / Capture TextComponent for test button to read current value
      let toastTopText: import("obsidian").TextComponent
      new Setting(set)
        .setName($("setting.general.mobile_toast_top"))
        .addText((text) => {
          text
            .setPlaceholder(Platform.isTablet ? "126" : "110")
            .setValue(this.plugin.settings.mobileToastTop.toString())
            .onChange(async (value) => {
              const numValue = parseInt(value)
              if (!isNaN(numValue) && numValue >= 0) {
                this.plugin.settings.mobileToastTop = numValue
                this.plugin.applyMobileToastTop()
                await this.plugin.saveAndReloadServices()
              }
            })
          toastTopText = text
        })
        .addButton((btn) =>
          btn.setButtonText($("setting.general.mobile_toast_top_test")).onClick(() => {
            const current = parseInt(toastTopText.getValue())
            const top = isNaN(current) ? this.plugin.settings.mobileToastTop : current
            showTestToast(top)
          }),
        )
      this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.general.mobile_toast_top_desc"))
    }

    new Setting(set).setName($("setting.general.show_share_icon")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.showShareIcon).onChange(async (value) => {
        if (value != this.plugin.settings.showShareIcon) {
          this.plugin.settings.showShareIcon = value
          await this.plugin.saveAndReloadServices()
          this.plugin.shareIndicatorManager.regenerateCss()
        }
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.general.show_share_icon_desc"))

    new Setting(set).setName($("setting.general.share_manage")).addButton((btn) =>
      btn.setButtonText($("setting.general.share_manage_button")).onClick(() => {
        new ShareManageModal(this.app, this.plugin).open()
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.general.share_manage_desc"))

    new Setting(set).setName($("setting.general.show_upgrade_badge")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.showUpgradeBadge).onChange(async (value) => {
        if (value != this.plugin.settings.showUpgradeBadge) {
          this.plugin.settings.showUpgradeBadge = value
          await this.plugin.saveAndReloadServices()
          this.plugin.menuManager?.refreshUpgradeBadge()
          // 触发设置变更事件以通知 React 视图 / Trigger settings change event to notify React views
          this.app.workspace.trigger("fns:settings-change")
        }
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.general.show_upgrade_badge_desc"))

    new Setting(set).setName($("setting.general.block_upgrade")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.blockUpgrade).onChange(async (value) => {
        this.plugin.settings.blockUpgrade = value
        await this.plugin.saveSettings()
        this.plugin.menuManager?.refreshUpgradeBadge()
        // 触发设置变更事件以通知 React 视图 / Trigger settings change event to notify React views
        this.app.workspace.trigger("fns:settings-change")
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.general.block_upgrade_desc"))

    // 同步状态指示器 / Sync status indicator
    const syncSetting = new Setting(set).setName($("setting.display.show_sync_indicator")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.showSyncIndicator).onChange(async (value) => {
        this.plugin.settings.showSyncIndicator = value
        await this.plugin.saveSettings()
      }),
    )
    // 在标签右侧嵌入合成图标的静态预览 / Embed static composite icon preview next to label
    const preview = syncSetting.nameEl.createDiv("fns-sync-indicator-preview")
    const previewContainer = preview.createDiv("fns-ribbon-container")
    setIcon(previewContainer, "wifi")
    const previewSpinner = previewContainer.createDiv("fns-sync-spinner")
    previewSpinner.classList.add("fns-sync-preview")
    setIcon(previewSpinner, "refresh-cw")
    const syncDescEl = set.lastElementChild as HTMLElement
    this.setDescWithBreaks(syncDescEl, $("setting.display.show_sync_indicator_desc"))

    new Setting(set).setName($("setting.sync.show_concurrency_indicator")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.showConcurrencyIndicator).onChange(async (value) => {
        if (value != this.plugin.settings.showConcurrencyIndicator) {
          this.plugin.settings.showConcurrencyIndicator = value
          this.plugin.menuManager.refreshConcurrencyIndicator()
          await this.plugin.saveAndReloadServices("showConcurrencyIndicator")
        }
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.sync.show_concurrency_indicator_desc"))

    new Setting(set).setName($("setting.debug.show_version")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.showVersionInfo).onChange(async (value) => {
        this.plugin.settings.showVersionInfo = value
        await this.plugin.saveAndReloadServices()
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.debug.show_version_desc"))

    new Setting(set).setName($("setting.remote.mobile_status_dot_pos")).addDropdown((dropdown) =>
      dropdown
        .addOption("hidden", $("setting.remote.mobile_status_dot_pos_hidden"))
        .addOption("top-right", $("setting.remote.mobile_status_dot_pos_tr"))
        .addOption("top-left", $("setting.remote.mobile_status_dot_pos_tl"))
        .addOption("bottom-right", $("setting.remote.mobile_status_dot_pos_br"))
        .addOption("bottom-left", $("setting.remote.mobile_status_dot_pos_bl"))
        .addOption("menu-bar", $("setting.remote.mobile_status_dot_pos_menu"))
        .setValue(this.plugin.settings.mobileStatusDotPosition || "top-right")
        .setDisabled(!Platform.isMobile)
        .onChange(async (value: string) => {
          this.plugin.settings.mobileStatusDotPosition = value as "hidden" | "top-right" | "top-left" | "bottom-right" | "bottom-left" | "menu-bar"
          await this.plugin.saveAndReloadServices()
          this.plugin.menuManager?.updateRibbonIcon(this.plugin.websocket.isAuth)
        }),
    )
    let posDesc = $("setting.remote.mobile_status_dot_pos_desc")
    if (!Platform.isMobile) {
      posDesc += "\n\n" + $("setting.remote.mobile_status_dot_pos_hint")
    }
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, posDesc)
  }

  private renderRemoteSettings(set: HTMLElement) {
    new Setting(set).setDesc($("setting.remote.setup_desc")).setHeading().setClass("fast-note-sync-settings-tag-desc")

    const apiSet = set.createDiv()
    apiSet.addClass("fast-note-sync-settings")

    const root = createRoot(apiSet)
    this.roots.push(root)
    // 预设一个小文本，防止被搜索逻辑判定为“空元素”而隐藏
    apiSet.setText(" ")
    window.setTimeout(() => {
      root.render(<SettingsView plugin={this.plugin} />)
    }, 50)

    new Setting(set)
      .setClass("fns-setting-item-vertical")
      .setName($("setting.remote.api_url"))
      .addText((text) =>
        text
          .setPlaceholder($("setting.remote.api_url_placeholder"))
          .setValue(this.plugin.settings.api)
          .onChange(async (value) => {
            if (value != this.plugin.settings.api) {
              this.plugin.wsSettingChange = true
              this.plugin.settings.api = value
              this.plugin.localStorageManager.clearSyncTime()
              await this.plugin.saveAndReloadServices()
            }
          }),
      )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.remote.api_url_desc"))

    if (this.plugin.settings.api && this.plugin.settings.api.toLowerCase().startsWith("http://")) {
      const warningEl = set.createDiv("fns-setting-warning");
      warningEl.setText($("setting.remote.http_warning"));
    }

    new Setting(set)
      .setClass("fns-setting-item-vertical")
      .setName($("setting.remote.api_token"))
      .addText((text) =>
        text
          .setPlaceholder($("setting.remote.api_token_placeholder"))
          .setValue(this.plugin.settings.apiToken)
          .onChange(async (value) => {
            if (value != this.plugin.settings.apiToken) {
              this.plugin.wsSettingChange = true
              this.plugin.settings.apiToken = value
              this.plugin.localStorageManager.clearSyncTime()
              await this.plugin.saveAndReloadServices()
            }
          }),
      )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.remote.api_token_desc"))

    new Setting(set)
      .setName($("setting.remote.vault_name"))
      .addText((text) => {
        text
          .setPlaceholder($("setting.remote.vault_name"))
          .setValue(this.plugin.settings.vault);
        
        text.inputEl.readOnly = true;
        text.inputEl.addClass("fns-clickable");

        text.inputEl.addEventListener("focus", () => {
          text.inputEl.blur();
        });

        text.inputEl.onclick = () => {
          new VaultNameModal(this.app, this.plugin.settings.vault, async (newValue) => {
            await updateVaultName(this.plugin, newValue);
            text.setValue(newValue);
            showSyncNotice($("setting.debug.clear_cache_success") || "Sync cache cleared successfully");
          }).open();
        };
      });
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.remote.vault_name_desc"))

    new Setting(set).setName($("setting.remote.auto_redirect")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.autoRedirectEnabled).onChange(async (value) => {
        this.plugin.settings.autoRedirectEnabled = value
        await this.plugin.saveAndReloadServices()
        this.refresh()
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.remote.auto_redirect_desc"))

    if (this.plugin.settings.autoRedirectEnabled) {
      new Setting(set)
        .setName($("setting.remote.allowed_redirect_domains") || "跳转域名允许清单")
        .addTextArea((text) =>
          text
            .setPlaceholder("例如: *.example.com\nbackup.myvault.cn")
            .setValue(this.plugin.settings.allowedRedirectDomains || "")
            .onChange(async (value) => {
              this.plugin.settings.allowedRedirectDomains = value
              await this.plugin.saveSettings()
            }),
        )
      this.setDescWithBreaks(
        set.lastElementChild as HTMLElement,
        $("setting.remote.allowed_redirect_domains_desc") || "设置允许自动重定向的目标域名列表。相同域名下的重定向默认允许。多条规则请使用换行或逗号分隔，支持通配符（如 *.example.com）。"
      )
    }

    new Setting(set).setName($("setting.remote.ws_pre_probe")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.wsPreProbeEnabled).onChange(async (value) => {
        this.plugin.settings.wsPreProbeEnabled = value
        await this.plugin.saveAndReloadServices()
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.remote.ws_pre_probe_desc"))

    new Setting(set).setName($("setting.remote.client_name")).addText((text) =>
      text
        .setPlaceholder($("setting.remote.client_name_placeholder"))
        .setValue(this.plugin.localStorageManager.getMetadata("clientName") as string)
        .onChange(async (value) => {
          const trimmedValue = value.trim()
          if (trimmedValue != this.plugin.localStorageManager.getMetadata("clientName")) {
            this.plugin.localStorageManager.setMetadata("clientName", trimmedValue)
          }
        }),
    )
    this.setDescWithBreaks(
      set.lastElementChild as HTMLElement,
      $("setting.remote.client_name_desc") + "\n*(隐私提示：若不配置将默认回退为操作系统通用标识，如需自定义建议使用不包含您真实全名或设备隐私特征的代号)*"
    )
  }

  private renderShortcutSettings(set: HTMLElement) {
    new Setting(set).setDesc($("setting.shortcut.title_desc")).setHeading().setClass("fast-note-sync-settings-tag-desc")

    const shortcutSetting = new Setting(set).setName($("setting.shortcut.open_log")).setDesc($("setting.shortcut.open_log_desc"))

    const displayShortcut = (val: string) => {
      if (!val) return ""
      let display = val
      if (Platform.isMacOS) {
        display = display.replace(/Mod/g, "Cmd").replace(/Ctrl/g, "Control")
      } else {
        display = display.replace(/Mod/g, "Ctrl")
      }
      return display
    }

    shortcutSetting.addText((text) => {
      text.setPlaceholder("Ctrl+Shift+Q").setValue(displayShortcut(this.plugin.getCommandHotkey("open-sync-log")))

      text.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
        void (async () => {
          e.preventDefault()
          e.stopPropagation()

          const modifiers = []
          if (e.ctrlKey) modifiers.push(Platform.isMacOS ? "Control" : "Ctrl")
          if (e.metaKey) modifiers.push(Platform.isMacOS ? "Cmd" : "Meta")
          if (e.altKey) modifiers.push("Alt")
          if (e.shiftKey) modifiers.push("Shift")

          let key = e.key
          if (["Control", "Meta", "Alt", "Shift"].includes(key)) {
            key = ""
          }

          if (modifiers.length > 0 || key) {
            let shortcutStr = modifiers.join("+")
            if (key) {
              if (shortcutStr) shortcutStr += "+"
              shortcutStr += key.toUpperCase()
            }

            let storageStr = shortcutStr
            if (Platform.isMacOS) {
              storageStr = storageStr.replace(/Cmd/g, "Mod").replace(/Control/g, "Ctrl")
            } else {
              storageStr = storageStr.replace(/Ctrl/g, "Mod")
            }

            text.setValue(shortcutStr)
            await this.plugin.setCommandHotkey("open-sync-log", storageStr)
          }
        })();
      })
    })

    shortcutSetting.addButton((btn) => {
      btn.setButtonText($("ui.button.reset")).onClick(async () => {
        await this.plugin.setCommandHotkey("open-sync-log", "Ctrl+Shift+Q")
        this.lastViewMode = "" // 强制重新渲染内容
        this.refresh()
      })
    })

    const menuShortcutSetting = new Setting(set).setName($("setting.shortcut.open_menu")).setDesc($("setting.shortcut.open_menu_desc"))

    menuShortcutSetting.addText((text) => {
      text.setPlaceholder("Ctrl+Shift+W").setValue(displayShortcut(this.plugin.getCommandHotkey("open-sync-menu")))

      text.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
        void (async () => {
          e.preventDefault()
          e.stopPropagation()

          const modifiers = []
          if (e.ctrlKey) modifiers.push(Platform.isMacOS ? "Control" : "Ctrl")
          if (e.metaKey) modifiers.push(Platform.isMacOS ? "Cmd" : "Meta")
          if (e.altKey) modifiers.push("Alt")
          if (e.shiftKey) modifiers.push("Shift")

          let key = e.key
          if (["Control", "Meta", "Alt", "Shift"].includes(key)) {
            key = ""
          }

          if (modifiers.length > 0 || key) {
            let shortcutStr = modifiers.join("+")
            if (key) {
              if (shortcutStr) shortcutStr += "+"
              shortcutStr += key.toUpperCase()
            }

            let storageStr = shortcutStr
            if (Platform.isMacOS) {
              storageStr = storageStr.replace(/Cmd/g, "Mod").replace(/Control/g, "Ctrl")
            } else {
              storageStr = storageStr.replace(/Ctrl/g, "Mod")
            }

            text.setValue(shortcutStr)
            await this.plugin.setCommandHotkey("open-sync-menu", storageStr)
          }
        })();
      })
    })

    menuShortcutSetting.addButton((btn) => {
      btn.setButtonText($("ui.button.reset")).onClick(async () => {
        await this.plugin.setCommandHotkey("open-sync-menu", "Ctrl+Shift+W")
        this.lastViewMode = "" // 强制重新渲染内容
        this.refresh()
      })
    })

    const settingShortcutSetting = new Setting(set).setName($("setting.shortcut.open_settings")).setDesc($("setting.shortcut.open_settings_desc"))

    settingShortcutSetting.addText((text) => {
      text.setPlaceholder("Ctrl+Shift+S").setValue(displayShortcut(this.plugin.getCommandHotkey("open-settings")))

      text.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
        void (async () => {
          e.preventDefault()
          e.stopPropagation()

          const modifiers = []
          if (e.ctrlKey) modifiers.push(Platform.isMacOS ? "Control" : "Ctrl")
          if (e.metaKey) modifiers.push(Platform.isMacOS ? "Cmd" : "Meta")
          if (e.altKey) modifiers.push("Alt")
          if (e.shiftKey) modifiers.push("Shift")

          let key = e.key
          if (["Control", "Meta", "Alt", "Shift"].includes(key)) {
            key = ""
          }

          if (modifiers.length > 0 || key) {
            let shortcutStr = modifiers.join("+")
            if (key) {
              if (shortcutStr) shortcutStr += "+"
              shortcutStr += key.toUpperCase()
            }

            let storageStr = shortcutStr
            if (Platform.isMacOS) {
              storageStr = storageStr.replace(/Cmd/g, "Mod").replace(/Control/g, "Ctrl")
            } else {
              storageStr = storageStr.replace(/Ctrl/g, "Mod")
            }

            text.setValue(shortcutStr)
            await this.plugin.setCommandHotkey("open-settings", storageStr)
          }
        })();
      })
    })

    settingShortcutSetting.addButton((btn) => {
      btn.setButtonText($("ui.button.reset")).onClick(async () => {
        await this.plugin.setCommandHotkey("open-settings", "Ctrl+Shift+S")
        this.lastViewMode = "" // 强制重新渲染内容
        this.refresh()
      })
    })
  }

  private renderSyncSettings(set: HTMLElement) {
    new Setting(set).setName($("setting.sync.auto_note")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.syncEnabled).onChange(async (value) => {
        if (value != this.plugin.settings.syncEnabled) {
          this.plugin.settings.syncEnabled = value
          this.refresh()
          await this.plugin.saveAndReloadServices("syncEnabled")
        }
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.sync.auto_note_desc"))

    new Setting(set).setName($("setting.sync.auto_config")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.configSyncEnabled).onChange(async (value) => {
        if (value != this.plugin.settings.configSyncEnabled) {
          this.plugin.settings.configSyncEnabled = value
          await this.plugin.saveAndReloadServices("configSyncEnabled")
        }
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.sync.auto_config_desc"))

    new Setting(set).setName($("setting.sync.binary_limit")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.binarySyncLimitEnabled).onChange(async (value) => {
        if (value != this.plugin.settings.binarySyncLimitEnabled) {
          this.plugin.settings.binarySyncLimitEnabled = value
          this.refresh()
          await this.plugin.saveAndReloadServices("binarySyncLimitEnabled")
        }
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.sync.binary_limit_desc"))

    if (this.plugin.settings.binarySyncLimitEnabled) {
      new Setting(set).setName($("setting.sync.attachment_limit")).addText((text) =>
        text
          .setPlaceholder("50")
          .setValue((this.plugin.settings.attachmentSyncLimit ?? 50).toString())
          .onChange(async (value) => {
            const numValue = parseInt(value)
            if (!isNaN(numValue) && numValue >= 0) {
              this.plugin.settings.attachmentSyncLimit = numValue
              await this.plugin.saveAndReloadServices()
            }
          }),
      )
      this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.sync.attachment_limit_desc") + "\n" + $("setting.sync.hash_sampling_desc"))
    }

    new Setting(set).setName($("setting.sync.note_limit")).addText((text) =>
      text
        .setPlaceholder("20")
        .setValue((this.plugin.settings.noteSyncLimit ?? 20).toString())
        .onChange(async (value) => {
          const numValue = parseInt(value)
          if (!isNaN(numValue) && numValue >= 0) {
            this.plugin.settings.noteSyncLimit = numValue
            await this.plugin.saveAndReloadServices()
          }
        }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.sync.note_limit_desc"))

    new Setting(set).setName($("setting.sync.hash_limit_toggle")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.hashSyncLimitEnabled !== false).onChange(async (value) => {
        if (value != this.plugin.settings.hashSyncLimitEnabled) {
          this.plugin.settings.hashSyncLimitEnabled = value
          this.refresh()
          await this.plugin.saveAndReloadServices()
        }
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.sync.hash_limit_toggle_desc"))

    if (this.plugin.settings.hashSyncLimitEnabled !== false) {
      new Setting(set).setName($("setting.sync.hash_limit")).addText((text) =>
        text
          .setPlaceholder("20000")
          .setValue((this.plugin.settings.hashSyncLimit ?? 20000).toString())
          .onChange(async (value) => {
            const numValue = parseInt(value)
            if (!isNaN(numValue) && numValue >= 0) {
              this.plugin.settings.hashSyncLimit = numValue
              await this.plugin.saveAndReloadServices()
            }
          }),
      )
      this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.sync.hash_limit_desc"))
    }

    new Setting(set).setName($("setting.sync.pdf_state")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.pdfSyncEnabled).onChange(async (value) => {
        if (value != this.plugin.settings.pdfSyncEnabled) {
          this.plugin.settings.pdfSyncEnabled = value
          await this.plugin.saveAndReloadServices()
        }
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.sync.pdf_state_desc"))

    new Setting(set).setName($("setting.sync.concurrency_control")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.concurrencyControlEnabled).onChange(async (value) => {
        if (value != this.plugin.settings.concurrencyControlEnabled) {
          this.plugin.settings.concurrencyControlEnabled = value
          this.plugin.menuManager.refreshConcurrencyIndicator()
          this.refresh()
          await this.plugin.saveAndReloadServices("concurrencyControlEnabled")
        }
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.sync.concurrency_control_desc"))

    if (this.plugin.settings.concurrencyControlEnabled) {
      new Setting(set).setName($("setting.sync.max_concurrency")).addSlider((slider) =>
        slider
          .setLimits(1, 200, 1)
          .setValue(this.plugin.settings.maxConcurrentUploads)
          .onChange(async (value) => {
            if (value != this.plugin.settings.maxConcurrentUploads) {
              this.plugin.settings.maxConcurrentUploads = value
              this.plugin.menuManager.refreshConcurrencyIndicator()
              await this.plugin.saveAndReloadServices("maxConcurrentUploads")
            }
          }),
      )
      this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.sync.max_concurrency_desc"))
    }

    new Setting(set).setName($("setting.sync.offline_delete")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.offlineDeleteSyncEnabled).onChange(async (value) => {
        if (value != this.plugin.settings.offlineDeleteSyncEnabled) {
          this.plugin.settings.offlineDeleteSyncEnabled = value
          await this.plugin.saveAndReloadServices()
        }
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.sync.offline_delete_desc"))

    new Setting(set).setName($("setting.sync.manual_sync")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.manualSyncEnabled).onChange(async (value) => {
        if (value != this.plugin.settings.manualSyncEnabled) {
          this.plugin.settings.manualSyncEnabled = value
          await this.plugin.saveAndReloadServices()
        }
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.sync.manual_sync_desc"))

    new Setting(set).setName($("setting.sync.readonly_sync")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.readonlySyncEnabled).onChange(async (value) => {
        if (value != this.plugin.settings.readonlySyncEnabled) {
          this.plugin.settings.readonlySyncEnabled = value
          await this.plugin.saveAndReloadServices()
        }
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.sync.readonly_sync_desc"))

    new Setting(set).setName($("setting.sync.auto_pause_minimized")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.autoPauseMinimized).onChange(async (value) => {
        if (value != this.plugin.settings.autoPauseMinimized) {
          this.plugin.settings.autoPauseMinimized = value
          await this.plugin.saveAndReloadServices()
        }
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.sync.auto_pause_minimized_desc"))

    new Setting(set).setName($("setting.sync.mobile_blur_pause")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.mobileBlurPauseEnabled).onChange(async (value) => {
        if (value != this.plugin.settings.mobileBlurPauseEnabled) {
          this.plugin.settings.mobileBlurPauseEnabled = value
          await this.plugin.saveAndReloadServices()
        }
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.sync.mobile_blur_pause_desc"))

    this.addRuleSetting(
      set,
      $("setting.sync.exclude"),
      $("setting.sync.exclude_desc"),
      () => parseRules(this.plugin.settings.syncExcludeFolders),
      async (rules) => {
        this.plugin.settings.syncExcludeFolders = JSON.stringify(rules)
        await this.plugin.saveAndReloadServices()
      },
      true,
      $("ui.button.add_rule"),
      $("setting.sync.exclude_placeholder"),
      $("ui.button.edit_exclude"),
      true,
    )

    this.addRuleSetting(
      set,
      $("setting.sync.exclude_extensions"),
      $("setting.sync.exclude_extensions_desc"),
      () => parseRules(this.plugin.settings.syncExcludeExtensions),
      async (rules) => {
        this.plugin.settings.syncExcludeExtensions = JSON.stringify(rules)
        await this.plugin.saveAndReloadServices()
      },
      false,
      $("ui.button.add_rule"),
      $("setting.sync.exclude_extensions_placeholder"),
      $("ui.button.edit_extension"),
    )

    this.addRuleSetting(
      set,
      $("setting.sync.exclude_whitelist"),
      $("setting.sync.exclude_whitelist_desc"),
      () => parseRules(this.plugin.settings.syncExcludeWhitelist),
      async (rules) => {
        this.plugin.settings.syncExcludeWhitelist = JSON.stringify(rules)
        await this.plugin.saveAndReloadServices()
      },
      true,
      $("ui.button.add_rule"),
      $("setting.sync.exclude_placeholder"),
      $("ui.button.edit_whitelist"),
      true,
    )

    this.addRuleSetting(
      set,
      $("setting.sync.config_dirs"),
      $("setting.sync.config_dirs_desc"),
      () => parseRules(this.plugin.settings.configSyncOtherDirs),
      async (rules) => {
        this.plugin.settings.configSyncOtherDirs = JSON.stringify(rules)
        await this.plugin.saveAndReloadServices()
      },
      false,
      $("ui.button.add_dir"),
      $("setting.sync.config_dirs_placeholder"),
      $("ui.button.edit_dir"),
      true,
      { onlyFolders: true, onlyHidden: false, excludeConfigDir: true },
    )

    new Setting(set).setName($("setting.sync.sync_delay")).addText((text) =>
      text
        .setPlaceholder("0")
        .setValue(this.plugin.settings.syncUpdateDelay.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value)
          if (!isNaN(numValue) && numValue >= 0) {
            this.plugin.settings.syncUpdateDelay = numValue
            await this.plugin.saveAndReloadServices()
          }
        }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.sync.sync_delay_desc"))

    new Setting(set)
      .setName($("setting.sync.merge_strategy"))
      .setClass("fns-setting-item-vertical")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("", $("setting.sync.strategy_default"))
          .addOption("newTimeMerge", $("setting.sync.strategy_new"))
          .addOption("ignoreTimeMerge", $("setting.sync.strategy_force"))
          .addOption("manualMerge", $("setting.sync.strategy_manual"))
          .setValue(this.plugin.settings.offlineSyncStrategy || "")
          .onChange(async (value) => {
            this.plugin.settings.offlineSyncStrategy = value
            await this.plugin.saveAndReloadServices("offlineSyncStrategy")
            this.plugin.websocket.sendClientInfo()
          }),
      )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.sync.merge_strategy_desc"))
  }

  /**
   * 内置博客设置页
   * 数据来自服务端的 /api/blog/config 与 /api/blog/posts
   */
  private renderBlogSettings(set: HTMLElement) {
    const descEl = set.createDiv()
    descEl.setText($("setting.blog.status_desc"))

    const loadingEl = set.createDiv()
    loadingEl.setText("…")

    void (async () => {
      const cfg = await this.plugin.api.getBlogConfig()
      loadingEl.remove()

      if (!cfg) {
        const errEl = set.createDiv()
        errEl.setText($("setting.blog.unavailable"))
        return
      }

      new Setting(set)
        .setName($("setting.blog.enabled"))
        .setClass("fns-setting-item-checkbox")
        .addToggle((toggle) =>
          toggle.setValue(cfg.enabled).onChange(async (value) => {
            const ok = await this.plugin.api.updateBlogConfig({ enabled: value })
            if (!ok) new Notice($("setting.blog.not_admin"))
          }),
        )
      this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.blog.enabled_desc"))

      new Setting(set)
        .setName($("setting.blog.title"))
        .addText((text) =>
          text.setPlaceholder("Notes").setValue(cfg.title).onChange(async (value) => {
            const ok = await this.plugin.api.updateBlogConfig({ title: value })
            if (!ok) new Notice($("setting.blog.not_admin"))
          }),
        )
      this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.blog.title_desc"))

      new Setting(set)
        .setName($("setting.blog.open"))
        .addButton((btn) =>
          btn.setButtonText($("setting.blog.open")).onClick(() => {
            window.open(cfg.homeUrl, "_blank")
          }),
        )
      this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.blog.open_desc"))

      // 已发布笔记列表 / List of published notes
      const posts = await this.plugin.api.listBlogPosts()
      new Setting(set).setName($("setting.blog.posts")).setHeading()

      if (!posts.list.length) {
        // 这里原先直接 return。它只该跳过这张列表，而它跳过了本函数后面的一切 ——
        // 于是当读者还没有任何已发布笔记时，图谱、RSS、访问日志三块设置根本不会渲染出来，
        // 而那正是他最需要去打开它们的时刻。
        const emptyEl = set.createDiv()
        emptyEl.setText($("setting.blog.posts_empty"))
      } else {
        const listEl = set.createDiv("fns-blog-posts")
        for (const p of posts.list) {
          const row = listEl.createDiv("fns-blog-post-row")
          const link = row.createEl("a", { text: p.title, href: p.url })
          link.setAttr("target", "_blank")
          if (p.createdAt) {
            row.createSpan({ text: p.createdAt, cls: "fns-blog-post-date" })
          }
        }
      }

      this.renderBlogGraphSettings(set, cfg)
      this.renderBlogRssSettings(set, cfg.homeUrl)
      this.renderBlogAccessLogSettings(set)
      this.renderBlogPageSettings(set)
    })()
  }

  /**
   * 图谱设置。
   *
   * 这几项此前只能在服务端 config.yaml 里改，而它们恰恰是最常被调的东西：
   * 关了图谱的文章页更安静，深度决定读者一进来能看见多少关联。
   * 放进设置页之后，改完刷新博客即可看到，不必去碰服务器上的文件。
   */
  private renderBlogGraphSettings(set: HTMLElement, cfg: BlogConfig) {
    new Setting(set).setName($("setting.blog_graph.title")).setHeading()

    new Setting(set)
      .setName($("setting.blog_graph.show"))
      .setClass("fns-setting-item-checkbox")
      .addToggle((toggle) =>
        toggle.setValue(cfg.showGraph).onChange(async (value) => {
          const ok = await this.plugin.api.updateBlogConfig({ showGraph: value })
          if (!ok) new Notice($("setting.blog.not_admin"))
        }),
      )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.blog_graph.show_desc"))

    // 深度用滑块：取值只有 1..3，而且改动的效果是"看得见更多还是更少"，
    // 属于更适合拖动试的连续量，而不是需要精确输入的数字。
    let depthValue = cfg.localGraphDepth
    const depthSetting = new Setting(set)
      .setName($("setting.blog_graph.depth"))
      .addSlider((slider) =>
        slider
          .setLimits(1, 3, 1)
          .setValue(depthValue)
          .setDynamicTooltip()
          .onChange(async (value) => {
            depthValue = value
            const ok = await this.plugin.api.updateBlogConfig({ localGraphDepth: value })
            if (!ok) new Notice($("setting.blog.not_admin"))
          }),
      )
    this.setDescWithBreaks(depthSetting.descEl, $("setting.blog_graph.depth_desc"))

    new Setting(set)
      .setName($("setting.blog_graph.scope"))
      .addDropdown((dd) =>
        dd
          .addOption("shared", $("setting.blog_graph.scope_shared"))
          .addOption("all", $("setting.blog_graph.scope_all"))
          .setValue(cfg.graphScope)
          .onChange(async (value) => {
            const ok = await this.plugin.api.updateBlogConfig({
              graphScope: value as "shared" | "all",
            })
            if (!ok) new Notice($("setting.blog.not_admin"))
          }),
      )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.blog_graph.scope_desc"))

    new Setting(set)
      .setName($("setting.blog_graph.max_nodes"))
      .addText((text) =>
        text
          .setPlaceholder("120")
          .setValue(String(cfg.maxGraphNodes))
          .onChange(async (value) => {
            const n = Number.parseInt(value, 10)
            // 非法输入留给服务端夹取，不在这里静默改成别的值 ——
            // 读者输入 1000 时应当看到它被限到 400，而不是看到一个他没打的数字。
            if (!Number.isFinite(n)) return
            const ok = await this.plugin.api.updateBlogConfig({ maxGraphNodes: n })
            if (!ok) new Notice($("setting.blog.not_admin"))
          }),
      )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.blog_graph.max_nodes_desc"))

    new Setting(set)
      .setName($("setting.blog_graph.open"))
      .addButton((btn) =>
        btn.setButtonText($("setting.blog_graph.open_btn")).onClick(() => {
          window.open(cfg.homeUrl, "_blank")
        }),
      )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.blog_graph.open_desc"))
  }

  /**
   * RSS 订阅。
   *
   * 这里不提供开关：订阅源由服务端按已发布笔记实时生成，关闭它只会让读者复制到一个 404。
   * 提供的是地址、复制与校验 —— 也就是把"我该把哪个链接给别人"这件事一次说清。
   */
  private renderBlogRssSettings(set: HTMLElement, homeUrl: string) {
    new Setting(set).setName($("setting.blog_rss.title")).setHeading()

    const rssUrl = homeUrl.replace(/\/+$/, "") + "/rss.xml"

    new Setting(set)
      .setName($("setting.blog_rss.url"))
      .addText((text) => {
        text.setValue(rssUrl)
        text.inputEl.readOnly = true
        // 只读但可选中：读者要的是把它粘到别处，而不是在插件里编辑它。
        text.inputEl.addEventListener("focus", () => text.inputEl.select())
      })
      .addExtraButton((btn) =>
        btn
          .setIcon("copy")
          .setTooltip($("setting.blog_rss.copy"))
          .onClick(async () => {
            await navigator.clipboard.writeText(rssUrl)
            new Notice($("setting.blog_rss.copied"))
          }),
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("external-link")
          .setTooltip($("setting.blog_rss.open"))
          .onClick(() => window.open(rssUrl, "_blank")),
      )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.blog_rss.url_desc"))
  }

  /**
   * 访问日志。
   *
   * 默认不加载，点开才请求：它是唯一会按天累积的服务端数据，而主人绝大多数时候
   * 打开设置页并不是为了看它。摘要先给"有多少访问、有没有出错、哪些页面被读得最多"，
   * 明细收在折叠里 —— 逐条记录适合排查，不适合当首屏。
   *
   * 唯一访客数按设计无法计算（服务端不存任何可区分访客的标识），
   * 因此这里显示「不适用」而不是把服务端的 0 当作真实数字展示。
   */
  private renderBlogAccessLogSettings(set: HTMLElement) {
    new Setting(set).setName($("setting.blog_access.title")).setHeading()

    const descEl = set.createDiv()
    descEl.setText($("setting.blog_access.desc"))

    const holder = set.createDiv("fns-blog-access")

    new Setting(set)
      .setName($("setting.blog_access.load"))
      .addDropdown((dd) =>
        dd
          .addOption("7", $("setting.blog_access.days_7"))
          .addOption("14", $("setting.blog_access.days_14"))
          .addOption("30", $("setting.blog_access.days_30"))
          .setValue("7")
          // 选中的天数要真的被用上。早先这里与下面的按钮都调 render(7)，
          // 于是选「30 天」看到的仍是 7 天 —— 控件看起来工作了，实际没有。
          .onChange((value) => render(Number.parseInt(value, 10) || 7)),
      )
      .addButton((btn) =>
        btn.setButtonText($("setting.blog_access.load_btn")).onClick(() => render(7)),
      )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.blog_access.load_desc"))

    const render = (days: number) => {
      holder.empty()
      const busy = holder.createDiv("fns-blog-access-busy")
      busy.setText($("setting.blog_access.loading"))

      void (async () => {
        const page = await this.plugin.api.getBlogAccessLog(days, 200)
        holder.empty()
        if (!page) {
          holder.createDiv("fns-blog-access-err").setText($("setting.blog_access.unavailable"))
          return
        }

        const s = page.summary
        const stats = holder.createDiv("fns-blog-access-stats")
        const addStat = (label: string, value: string) => {
          const cell = stats.createDiv("fns-blog-access-stat")
          cell.createDiv("fns-blog-access-stat-v").setText(value)
          cell.createDiv("fns-blog-access-stat-l").setText(label)
        }
        addStat($("setting.blog_access.total"), String(s.total))
        addStat($("setting.blog_access.err4"), String(s.status4xx))
        addStat($("setting.blog_access.err5"), String(s.status5xx))
        // 不适用，而不是 0 —— 服务端按隐私设计不存可区分访客的标识。
        addStat($("setting.blog_access.uniques"), $("setting.blog_access.na"))

        if (s.byPath.length) {
          holder.createDiv("fns-blog-access-h").setText($("setting.blog_access.top_paths"))
          const pt = holder.createDiv("fns-blog-access-table")
          for (const row of s.byPath.slice(0, 8)) {
            const r = pt.createDiv("fns-blog-access-tr")
            r.createDiv("fns-blog-access-td-k").setText(row.key)
            r.createDiv("fns-blog-access-td-n").setText(String(row.count))
          }
        }

        if (s.byDay.length) {
          holder.createDiv("fns-blog-access-h").setText($("setting.blog_access.by_day"))
          const dt = holder.createDiv("fns-blog-access-table")
          for (const row of s.byDay.slice(0, 10)) {
            const r = dt.createDiv("fns-blog-access-tr")
            r.createDiv("fns-blog-access-td-k").setText(row.key)
            r.createDiv("fns-blog-access-td-n").setText(String(row.count))
          }
        }

        // 明细收进折叠：默认摊开会把首屏给掉，而排查时才需要它。
        const det = holder.createEl("details", { cls: "fns-blog-access-detail" })
        det.createEl("summary", { text: $("setting.blog_access.detail") })
        const tbl = det.createDiv("fns-blog-access-table")
        const head = tbl.createDiv("fns-blog-access-tr fns-is-head")
        // 逐项列出而不是拼 "col_" + key:$() 的入参是字面量联合类型,
        // 拼接出来的 string 不在其中 —— 那样写会静默退化成运行时的键查找,丢掉拼写检查。
        for (const label of [
          $("setting.blog_access.col_time"),
          $("setting.blog_access.col_method"),
          $("setting.blog_access.col_path"),
          $("setting.blog_access.col_status"),
          $("setting.blog_access.col_ms"),
          $("setting.blog_access.col_ip"),
          $("setting.blog_access.col_client"),
        ]) {
          head.createDiv("fns-blog-access-td-k").setText(label)
        }
        for (const e of page.entries.slice(0, 100)) {
          const r = tbl.createDiv("fns-blog-access-tr")
          for (const v of [e.time, e.method, e.path, String(e.status), String(e.ms), e.ip, e.client]) {
            r.createDiv("fns-blog-access-td-k").setText(v)
          }
        }

        // 原样展示服务端给的隐私说明，而不是在插件里另写一段 ——
        // 两处各写一遍，早晚会有一处不再是真的。
        holder.createDiv("fns-blog-access-note").setText(page.note)
        if (page.entries.length === 0) {
          holder.createDiv("fns-blog-access-empty").setText($("setting.blog_access.empty"))
        }
      })()
    }
  }

  /**
   * 页面笔记（简历页）。
   *
   * 服务端靠 `page: about` 标记识别页面，不依赖路径 —— 笔记放在哪都行。
   * 这里做的是另一件事：把「建一篇笔记、写上标记、再套上排版」变成一次点击。
   *
   * 三条刻意的设计：
   *  1. **不自动创建**。插件在没有被要求的情况下往 vault 里写文件是不礼貌的：
   *     主人的仓库会凭空出现一个文件夹和一份文件。改为检测后提示，单击才创建。
   *  2. **绝不覆盖**。已有文件一律不动，哪怕内容看起来是空的。
   *  3. **候选路径有序探测**。用户的中文 vault 里，`关于.md` 比 `about.md` 更自然，
   *     所以两个都认，按顺序找。设置页显示实际命中的是哪一个 ——
   *     「我改了文件怎么没生效」这类问题因此一眼可见。
   */
  private renderBlogPageSettings(set: HTMLElement) {
    new Setting(set).setName($("setting.blog_page.title")).setHeading()

    const descEl = set.createDiv()
    descEl.setText($("setting.blog_page.desc"))

    const statusEl = set.createDiv("fns-blog-page-status")

    // 候选顺序：文件夹内先找中文名，再找英文名；再退到 vault 根目录。
    // 这与服务端无关（服务端靠标记），只是创建时的落点约定。
    const FOLDER = "简历"
    const CANDIDATES = [`${FOLDER}/关于.md`, `${FOLDER}/about.md`, "关于.md", "about.md"]
    const TARGET = `${FOLDER}/关于.md`

    const refresh = async () => {
      statusEl.empty()
      const adapter = this.plugin.app.vault.adapter

      let found: string | null = null
      for (const rel of CANDIDATES) {
        if (await adapter.exists(normalizePath(rel))) {
          found = rel
          break
        }
      }

      const row = statusEl.createDiv("fns-blog-page-row")
      if (found) {
        row.createSpan({ text: $("setting.blog_page.found"), cls: "fns-blog-page-label" })
        row.createEl("code", { text: found })
        const open = row.createEl("a", { text: $("setting.blog_page.open_hint"), href: "#" })
        open.addEventListener("click", (e) => {
          e.preventDefault()
          // 打开的是笔记本身，不是博客页面 —— 主人此刻要改的是内容。
          const f = this.plugin.app.vault.getAbstractFileByPath(normalizePath(found!))
          if (f) void this.plugin.app.workspace.getLeaf(false).openFile(f as never)
        })
      } else {
        row.createSpan({ text: $("setting.blog_page.missing"), cls: "fns-blog-page-label" })
      }
      return found
    }

    void refresh()

    new Setting(set)
      .setName($("setting.blog_page.create"))
      .setDesc($("setting.blog_page.create_desc"))
      .addButton((btn) =>
        btn
          .setButtonText($("setting.blog_page.create_btn"))
          .setCta()
          .onClick(async () => {
            const adapter = this.plugin.app.vault.adapter
            const target = normalizePath(TARGET)

            // 已存在就只提示。覆盖主人的文件是不可逆的，而一次创建操作不值得那个风险。
            if (await adapter.exists(target)) {
              new Notice($("setting.blog_page.exists"))
              await refresh()
              return
            }

            try {
              if (!(await adapter.exists(normalizePath(FOLDER)))) {
                await adapter.mkdir(normalizePath(FOLDER))
              }
              await adapter.write(target, PAGE_SKELETON)
              new Notice($("setting.blog_page.created"))
              await refresh()
            } catch (e) {
              new Notice($("setting.blog_page.create_failed"))
              dumpError("create page note failed:", e)
            }
          }),
      )

    new Setting(set)
      .setName($("setting.blog_page.open"))
      .addButton((btn) =>
        btn.setButtonText($("setting.blog_page.open_btn")).onClick(() => {
          // 绝对地址在服务端拼（它知道 baseURL），这里只需要相对路径。
          window.open("/blog/about", "_blank")
        }),
      )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.blog_page.open_desc"))
  }

  /**
   * 博客问答（AI）设置
   * 数据来自服务端的 /api/blog/ai-config，仅管理员可写。
   *
   * 这里的采样参数一律用文本框而不是数字输入：presence-penalty 与 frequency-penalty
   * 必须能表达「显式 0」，而数字输入的 0 与「留空」在前端无法区分。留空即表示不发送该参数。
   */
  private renderBlogAskSettings(set: HTMLElement) {
    new Setting(set).setName($("setting.blog_ask.title")).setHeading()

    const descEl = set.createDiv()
    descEl.setText($("setting.blog_ask.desc"))

    // Where the entry actually lives on the blog, so there is no doubt about what this page
    // controls after saving.
    // 明确写出入口在博客上的位置，保存后不必猜这个页面对应的是什么。
    const pathEl = set.createDiv("fns-ask-path")
    pathEl.setText($("setting.blog_ask.where"))

    const loadingEl = set.createDiv()
    loadingEl.setText("…")

    void (async () => {
      const cfg = await this.plugin.api.getAIConfig()
      loadingEl.remove()

      if (!cfg) {
        const errEl = set.createDiv()
        errEl.setText($("setting.blog_ask.unavailable"))
        return
      }

      const save = async (patch: Parameters<typeof this.plugin.api.updateAIConfig>[0]) => {
        const ok = await this.plugin.api.updateAIConfig(patch)
        if (!ok) new Notice($("setting.blog.not_admin"))
        return ok
      }

      new Setting(set)
        .setName($("setting.blog_ask.enabled"))
        .setClass("fns-setting-item-checkbox")
        .addToggle((toggle) =>
          toggle.setValue(cfg.enabled).onChange(async (value) => {
            await save({ enabled: value })
          }),
        )
      this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.blog_ask.enabled_desc"))

      new Setting(set)
        .setName($("setting.blog_ask.open"))
        .addButton((btn) =>
          btn.setButtonText($("setting.blog.open")).onClick(() => window.open(cfg.homeUrl, "_blank")),
        )
      this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.blog_ask.open_desc"))

      // ── 模型线路 ────────────────────────────────────────────────────────
      new Setting(set).setName($("setting.blog_ask.routes")).setHeading()
      const routesDesc = set.createDiv()
      routesDesc.setText($("setting.blog_ask.routes_desc"))

      const routes = cfg.routes.length
        ? cfg.routes
        : [{ name: "", baseUrl: "", apiKey: "", model: "", minInterval: "1s", timeout: "120s", enabled: true }]

      const routesEl = set.createDiv("fns-ask-routes")
      routes.forEach((r, idx) => {
        const card = routesEl.createDiv("fns-ask-route")
        card.createDiv({ text: `${$("setting.blog_ask.route")} ${idx + 1}`, cls: "fns-ask-route-head" })

        const patchRoute = async (field: string, value: string | boolean) => {
          const next = routes.map((x, i) =>
            i === idx ? { ...x, [field]: value } : { name: x.name, baseUrl: x.baseUrl, apiKey: x.apiKey, model: x.model, minInterval: x.minInterval, timeout: x.timeout, enabled: x.enabled },
          )
          await save({ routes: next })
        }

        new Setting(card)
          .setName($("setting.blog_ask.route_name"))
          .addText((t) => t.setValue(r.name).onChange((v) => void patchRoute("name", v)))
        new Setting(card)
          .setName($("setting.blog_ask.base_url"))
          .addText((t) =>
            t.setPlaceholder("https://api.example.com/v1").setValue(r.baseUrl).onChange((v) => void patchRoute("baseUrl", v)),
          )
        new Setting(card)
          .setName($("setting.blog_ask.model"))
          .addText((t) => t.setPlaceholder("Qwen/Qwen3.5-4B").setValue(r.model).onChange((v) => void patchRoute("model", v)))
        new Setting(card)
          .setName($("setting.blog_ask.api_key"))
          .addText((t) => {
            t.inputEl.type = "password"
            t.setPlaceholder("sk-…").setValue(r.apiKey).onChange((v) => void patchRoute("apiKey", v))
          })
        new Setting(card)
          .setName($("setting.blog_ask.min_interval"))
          .setDesc($("setting.blog_ask.min_interval_desc"))
          .addText((t) => t.setPlaceholder("1s").setValue(r.minInterval).onChange((v) => void patchRoute("minInterval", v)))
        new Setting(card)
          .setName($("setting.blog_ask.timeout"))
          .setDesc($("setting.blog_ask.timeout_desc"))
          .addText((t) => t.setPlaceholder("120s").setValue(r.timeout).onChange((v) => void patchRoute("timeout", v)))
      })
    })()
  }

  private renderCloudSettings(set: HTMLElement) {
    new Setting(set).setName($("setting.cloud.title")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.cloudPreviewEnabled).onChange(async (value) => {
        if (value != this.plugin.settings.cloudPreviewEnabled) {
          this.plugin.settings.cloudPreviewEnabled = value
          await this.plugin.saveAndReloadServices()
          this.refresh()
        }
      }),
    )
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.cloud.desc"))

    if (this.plugin.settings.cloudPreviewEnabled) {
      new Setting(set).setName($("setting.cloud.type_limit")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.cloudPreviewTypeRestricted).onChange(async (value) => {
          if (value != this.plugin.settings.cloudPreviewTypeRestricted) {
            this.plugin.settings.cloudPreviewTypeRestricted = value
            await this.plugin.saveAndReloadServices()
          }
        }),
      )
      this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.cloud.type_limit_desc"))

      new Setting(set).setName($("setting.cloud.remote_source")).addTextArea((text) =>
        text
          .setPlaceholder("prefix@.jpg$.png#http://domain.com/{path}")
          .setValue(this.plugin.settings.cloudPreviewRemoteUrl)
          .onChange(async (value) => {
            if (value != this.plugin.settings.cloudPreviewRemoteUrl) {
              this.plugin.settings.cloudPreviewRemoteUrl = value
              await this.plugin.saveAndReloadServices()
            }
          })
          .inputEl.addClass("fast-note-sync-remote-url-area"),
      )
      const remoteUrlSetting = set.lastElementChild as HTMLElement
      remoteUrlSetting.addClass("fast-note-sync-remote-url-setting")
      this.setDescWithBreaks(remoteUrlSetting, $("setting.cloud.remote_source_desc"))

      new Setting(set).setName($("setting.cloud.delete_after_upload")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.cloudPreviewAutoDeleteLocal).onChange(async (value) => {
          if (value != this.plugin.settings.cloudPreviewAutoDeleteLocal) {
            this.plugin.settings.cloudPreviewAutoDeleteLocal = value
            await this.plugin.saveAndReloadServices()
          }
        }),
      )
      this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.cloud.delete_after_upload_desc"))

      new Setting(set).setName($("setting.cloud.dynamic_attachment")).setClass("fns-setting-item-checkbox").addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.cloudPreviewDynamicAttachment).onChange(async (value) => {
          if (value != this.plugin.settings.cloudPreviewDynamicAttachment) {
            this.plugin.settings.cloudPreviewDynamicAttachment = value
            await this.plugin.saveAndReloadServices()
          }
        }),
      )
      this.setDescWithBreaks(set.lastElementChild as HTMLElement, $("setting.cloud.dynamic_attachment_desc"))
    }
  }

  private setDescWithBreaks(el: HTMLElement, desc: string) {
    const descEl = el.querySelector(".setting-item-description") as HTMLElement
    if (descEl) {
      descEl.empty()
      descEl.addClass("fns-setting-desc-markdown")
      // 动态替换配置目录占位符 / Dynamically replace config directory placeholder
      const finalDesc = desc.replace(/\$\{configDir\}/g, this.app.vault.configDir);
      void MarkdownRenderer.render(this.app, finalDesc, descEl, "", this.component)
    }
  }

  private addRuleSetting(set: HTMLElement, name: string, desc: string, getRules: () => SyncRule[], onSave: (rules: SyncRule[]) => void | Promise<void>, showCaseSensitive: boolean = true, addButtonText?: string, inputPlaceholder?: string, editButtonText?: string, usePathSuggest: boolean = false, pathSuggestOptions: PathSuggestOptions = {}) {
    const setting = new Setting(set).setName(name).setClass("fns-setting-item-vertical")
    this.setDescWithBreaks(set.lastElementChild as HTMLElement, desc)

    const inlineContainer = setting.settingEl.createDiv("fns-rule-editor-inline")
    inlineContainer.hide()

    const defaultEditBtnText = editButtonText || $("ui.button.edit_rule")

    setting.addButton((btn) => {
      btn.setButtonText(defaultEditBtnText).onClick(() => {
        if (Platform.isMobile) {
          if (inlineContainer.isShown()) {
            inlineContainer.hide()
            btn.setButtonText(defaultEditBtnText)
            inlineContainer.empty()
          } else {
            inlineContainer.show()
            btn.setButtonText($("ui.button.collapse") || "收起")
            const editor = new RuleEditor(inlineContainer, this.app, name, "", getRules(), onSave, showCaseSensitive, addButtonText, inputPlaceholder, usePathSuggest, pathSuggestOptions)
            editor.load()
            editor.render()
          }
        } else {
          new RuleEditorModal(this.app, name, desc, getRules(), onSave, showCaseSensitive, addButtonText, inputPlaceholder, usePathSuggest, pathSuggestOptions).open()
        }
      })
    })
  }
}

/**
 * 优雅的原生输入模态框，用于指定版本安装等输入场景
 * Elegant native input modal for version installation and other text input scenarios
 */
export class InputModal extends Modal {
  private onSubmit: (value: string) => void;
  private inputEl: HTMLInputElement;

  constructor(
    app: App,
    private titleStr: string,
    private descStr: string,
    private placeholderStr: string,
    onSubmit: (value: string) => void
  ) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText(this.titleStr);

    contentEl.createEl("p", {
      text: this.descStr,
      cls: "fns-modal-desc"
    });

    const inputContainer = contentEl.createDiv("fns-modal-input-container");
    this.inputEl = inputContainer.createEl("input", {
      type: "text",
      placeholder: this.placeholderStr
    });
    this.inputEl.addClass("fns-modal-input");
    this.inputEl.focus();

    // 绑定 Enter 键触发提交 / Bind Enter key to submit
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        this.submit();
      }
    });

    const buttonContainer = contentEl.createDiv("fns-modal-button-container");

    const confirmBtn = buttonContainer.createEl("button", {
      text: $("ui.button.confirm") || "确认"
    });
    confirmBtn.addClass("mod-cta");
    confirmBtn.onclick = () => this.submit();

    const cancelBtn = buttonContainer.createEl("button", {
      text: $("ui.button.cancel") || "取消"
    });
    cancelBtn.onclick = () => this.close();
  }

  private submit() {
    const val = this.inputEl.value.trim();
    this.close();
    if (val) {
      this.onSubmit(val);
    } else {
      showSyncNotice($("setting.debug.version_install_empty") || "请输入要安装的版本号");
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * 优雅的原生库名输入模态框，用于点击库名输入框时弹出进行修改
 */
export class VaultNameModal extends Modal {
  private onSubmit: (value: string) => Promise<void> | void;
  private currentValue: string;
  private inputEl: HTMLInputElement;

  constructor(
    app: App,
    currentValue: string,
    onSubmit: (value: string) => Promise<void> | void
  ) {
    super(app);
    this.currentValue = currentValue;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText($("setting.remote.vault_name_confirm_title") || "确认修改远端笔记库名");

    contentEl.createEl("p", {
      text: $("setting.remote.vault_name_confirm_desc") || "修改远端笔记库名将会清空本地同步时间缓存，并在下一次同步时重新同步所有笔记。确定要修改吗？",
      cls: "fns-modal-desc"
    });

    const inputContainer = contentEl.createDiv("fns-modal-input-container");
    this.inputEl = inputContainer.createEl("input", {
      type: "text",
      placeholder: $("setting.remote.vault_name")
    });
    this.inputEl.addClass("fns-modal-input");
    this.inputEl.value = this.currentValue;
    this.inputEl.focus();

    // 选中全部文本
    this.inputEl.select();

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        void this.submit();
      }
    });

    const buttonContainer = contentEl.createDiv("fns-modal-button-container");

    const confirmBtn = buttonContainer.createEl("button", {
      text: $("ui.button.confirm") || "确认"
    });
    confirmBtn.addClass("mod-cta");
    confirmBtn.onclick = () => this.submit();

    const cancelBtn = buttonContainer.createEl("button", {
      text: $("ui.button.cancel") || "取消"
    });
    cancelBtn.onclick = () => this.close();
  }

  private async submit() {
    const val = this.inputEl.value.trim();
    if (!val) {
      showSyncNotice($("setting.remote.vault_name_empty") || "库名不能为空！");
      return;
    }
    this.close();
    if (val !== this.currentValue) {
      await this.onSubmit(val);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}


