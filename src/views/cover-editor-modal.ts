import { App, FuzzySuggestModal, Modal, Notice, TFile, setIcon } from "obsidian";
import type FastSync from "../main";
import {
    BlogCover,
    COVER_DEFAULT_FOCUS,
    COVER_MAX_ZOOM,
    COVER_MIN_ZOOM,
    clampCoverZoom,
    clampPercent,
    clearBlogCover,
    coverRefFor,
    defaultBlogCover,
    isCoverCandidate,
    isVideoCover,
    readBlogCover,
    writeBlogCover,
} from "../lib/blog/cover-frontmatter";

/**
 * 文章封面编辑器。
 *
 * 它存在的理由：博客首页的封面模式下，一张封面的裁切完全由 frontmatter 里的
 * `cover` / `cover-focus` / `cover-zoom` 三个值决定，而这三个值写错了服务端不会报错 ——
 * 它只会画出一张裁得莫名其妙的图，或者一个占位色块。所以调整必须当场看见结果，
 * 而不是改一个数字、同步、打开浏览器、刷新、再看。
 *
 * 预览用的是和服务端完全相同的几何：CSS 的 `background-size` + `background-position`
 * 与 `object-fit: cover` + `object-position` 对同一组百分比给出同一个裁切结果。
 * 换句话说这里看到的方框就是博客上那个方框，不是近似。
 *
 * 交互有三条路径，都指向同一组参数：
 *   - 在预览里拖动        → 改焦点
 *   - 在预览上滚轮        → 改缩放
 *   - 右侧滑块与数值      → 改缩放与焦点
 * 因为三者操作的是同一个状态对象，任何一条路径都不会和另外两条产生分歧。
 */

/** 拖动时每个像素对应的焦点百分比由溢出量决定，这里只限制单次拖动的灵敏度上限。 */
const DRAG_SENSITIVITY = 1;
/** 滚轮灵敏度。一次普通滚轮约 100 deltaY，对应约 15% 的缩放变化。 */
const WHEEL_SENSITIVITY = 0.0015;

export class CoverEditorModal extends Modal {
    private plugin: FastSync;
    private note: TFile;

    private cover: BlogCover = defaultBlogCover();
    /** true 表示 frontmatter 里本来就有一张封面，false 表示这是新设的。 */
    private hadCover = false;
    /** 正文第一张图，仅用于在界面上说明"不设封面时会用这张"。 */
    private bodyImage: TFile | null = null;
    /** 当前预览用的图片文件；封面可能指向一个已删除的文件。 */
    private imageFile: TFile | null = null;
    private naturalWidth = 0;
    private naturalHeight = 0;
    private imageReady = false;
    private imageFailed = false;

    private saving = false;

    private frameEl: HTMLElement | null = null;
    private cardFrameEl: HTMLElement | null = null;
    private zoomSlider: HTMLInputElement | null = null;
    private zoomLabel: HTMLElement | null = null;
    private focusLabel: HTMLElement | null = null;
    private statusEl: HTMLElement | null = null;
    private dragging = false;
    private dragOriginX = 0;
    private dragOriginY = 0;
    private dragFocusX = COVER_DEFAULT_FOCUS;
    private dragFocusY = COVER_DEFAULT_FOCUS;
    private detachFrame: (() => void) | null = null;

    constructor(app: App, plugin: FastSync, note: TFile) {
        super(app);
        this.plugin = plugin;
        this.note = note;
    }

    async onOpen(): Promise<void> {
        this.modalEl.addClass("fns-cover-modal");
        this.titleEl.setText("文章封面");
        this.titleEl.createSpan({ cls: "fns-cover-subtitle", text: this.note.basename });

        const fm = this.app.metadataCache.getFileCache(this.note)?.frontmatter;
        const stored = readBlogCover(fm as Record<string, unknown> | undefined);
        if (stored) {
            this.cover = stored;
            this.hadCover = true;
        } else {
            this.cover = defaultBlogCover();
        }

        this.bodyImage = await this.findBodyImage();
        this.imageFile = this.resolveImageFile(this.cover.ref) ?? this.bodyImage;
        if (this.imageFile && !this.hadCover) {
            // A note with no declared cover is currently shown with its first body image, so the
            // editor opens on that image rather than on an empty frame: the user came here to
            // adjust what the blog already shows.
            // 没声明封面的笔记现在用的是正文第一张图，所以编辑器直接拿它开局而不是一个空框：
            // 用户来这里是为了调整博客已经在显示的那张。
            this.cover.ref = coverRefFor(this.imageFile, this.note);
        }

        this.render();
        await this.loadImage();
    }

    onClose(): void {
        this.detachFrame?.();
        this.detachFrame = null;
        this.contentEl.empty();
    }

    // ── 内容探测 ────────────────────────────────────────────────────────

    /**
     * 找出正文里第一张图片。
     *
     * 服务端在没声明 cover 时就是这么退回的（feedCoverFor → firstBlogImageSrc），
     * 所以这里必须复刻同一套规则，否则编辑器会让用户以为"正文第一张图"是另一张。
     * 只扫前 200 行：一张封面取自正文时总是开头的图，而扫完几万字的笔记没有必要。
     */
    private async findBodyImage(): Promise<TFile | null> {
        let content: string;
        try {
            content = await this.app.vault.cachedRead(this.note);
        } catch {
            return null;
        }
        const head = content.split("\n").slice(0, 200).join("\n");

        const wiki = /!\[\[([^\]|#]+)/.exec(head);
        if (wiki) {
            const dest = this.app.metadataCache.getFirstLinkpathDest(wiki[1].trim(), this.note.path);
            if (dest && isCoverCandidate(dest)) return dest;
        }
        const md = /!\[[^\]]*\]\(([^)\s]+)/.exec(head);
        if (md) {
            const link = decodeURI(md[1].trim());
            const dest =
                this.app.metadataCache.getFirstLinkpathDest(link, this.note.path) ??
                this.app.vault.getAbstractFileByPath(link);
            if (dest instanceof TFile && isCoverCandidate(dest)) return dest;
        }
        return null;
    }

    /**
     * 把 frontmatter 里的引用解析成仓库文件。
     *
     * 先按 vault 路径直接找，再让 Obsidian 按链接规则找 —— 两者顺序与服务端一致
     * （先笔记目录相对路径，再后缀邻近择一），只是这里交给 Obsidian 的解析器做，
     * 它认识子路径、别名与锚点。
     */
    private resolveImageFile(ref: string): TFile | null {
        if (!ref) return null;
        const direct = this.app.vault.getAbstractFileByPath(ref);
        if (direct instanceof TFile) return direct;
        const resolved = this.app.metadataCache.getFirstLinkpathDest(ref, this.note.path);
        if (resolved) return resolved;
        const base = ref.split("/").pop() ?? ref;
        return this.app.metadataCache.getFirstLinkpathDest(base, this.note.path);
    }

    // ── 渲染 ───────────────────────────────────────────────────────────

    private render(): void {
        const { contentEl } = this;
        // render() is also called when the picked image changes, so the previous frame's
        // pointer and wheel listeners have to be released first — otherwise every re-render
        // leaves a dead frame still holding handlers, and pointer capture on a detached node
        // silently swallows the next drag.
        // render() 在更换图片时也会被调用，所以必须先释放上一张框上的指针与滚轮监听——
        // 否则每次重渲染都留下一个仍握着处理器的死框，而对已脱离文档的节点做指针捕获会
        // 无声地吞掉下一次拖动。
        this.detachFrame?.();
        this.detachFrame = null;

        contentEl.empty();
        contentEl.addClass("fns-cover-body");

        const layout = contentEl.createDiv("fns-cover-layout");
        this.renderPreview(layout.createDiv("fns-cover-stage"));
        this.renderPanel(layout.createDiv("fns-cover-panel"));
        this.renderFooter(contentEl);
    }

    private renderPreview(stage: HTMLElement): void {
        const frame = stage.createDiv("fns-cover-frame");
        this.frameEl = frame;
        frame.setAttr("tabindex", "0");
        frame.setAttr("role", "application");
        frame.setAttr("aria-label", "封面预览，拖动调整位置，滚轮调整缩放");

        if (!this.imageFile) {
            const empty = frame.createDiv("fns-cover-empty");
            const icon = empty.createDiv("fns-cover-empty-icon");
            setIcon(icon, "image-off");
            empty.createDiv("fns-cover-empty-text").setText(
                this.bodyImage ? "无法加载封面图片" : "这篇笔记没有图片，先选一张"
            );
        }

        const hint = stage.createDiv("fns-cover-hint");
        hint.setText("拖动调整位置 · 滚轮缩放 · 双击复位");

        this.attachFrameInteractions(frame);
    }

    private renderPanel(panel: HTMLElement): void {
        // 1. 图片来源
        const fileRow = panel.createDiv("fns-cover-row");
        fileRow.createDiv("fns-cover-row-label").setText("封面图片");
        const fileValue = fileRow.createDiv("fns-cover-file");
        const fileName = fileValue.createSpan("fns-cover-file-name");
        fileName.setText(this.imageFile ? this.imageFile.name : "未选择");
        if (this.imageFile) {
            fileName.setAttr("title", this.imageFile.path);
        }
        const pick = fileValue.createEl("button", { cls: "fns-cover-link", text: "更换" });
        pick.addEventListener("click", () => this.openPicker());

        // 2. 缩放
        const zoomRow = panel.createDiv("fns-cover-row");
        const zoomHead = zoomRow.createDiv("fns-cover-row-head");
        zoomHead.createSpan({ cls: "fns-cover-row-label", text: "缩放" });
        this.zoomLabel = zoomHead.createSpan("fns-cover-value");
        this.zoomLabel.setText(this.cover.zoom.toFixed(2) + "×");

        const slider = zoomRow.createEl("input", { cls: "fns-cover-slider" });
        slider.type = "range";
        slider.min = String(COVER_MIN_ZOOM * 100);
        slider.max = String(COVER_MAX_ZOOM * 100);
        slider.step = "1";
        slider.value = String(Math.round(this.cover.zoom * 100));
        slider.addEventListener("input", () => {
            this.setZoom(Number(slider.value) / 100);
        });
        this.zoomSlider = slider;

        // 3. 焦点，带三个快捷锚点
        const focusRow = panel.createDiv("fns-cover-row");
        const focusHead = focusRow.createDiv("fns-cover-row-head");
        focusHead.createSpan({ cls: "fns-cover-row-label", text: "焦点" });
        this.focusLabel = focusHead.createSpan("fns-cover-value");
        this.focusLabel.setText(`${this.cover.focusX}% ${this.cover.focusY}%`);

        const anchors = focusRow.createDiv("fns-cover-anchors");
        const anchorDefs: Array<[string, number, number]> = [
            ["顶部", 50, 0],
            ["居中", 50, 50],
            ["底部", 50, 100],
        ];
        for (const [label, x, y] of anchorDefs) {
            const btn = anchors.createEl("button", { cls: "fns-cover-anchor", text: label });
            btn.addEventListener("click", () => {
                this.cover.focusX = x;
                this.cover.focusY = y;
                this.paint();
            });
        }
        const reset = anchors.createEl("button", { cls: "fns-cover-anchor", text: "复位" });
        reset.addEventListener("click", () => this.resetTransform());

        // 4. 真实卡片预览：图片 + 标题 + 日期，和首页封面卡同构
        const cardSection = panel.createDiv("fns-cover-row fns-cover-row--card");
        cardSection.createDiv("fns-cover-row-label").setText("在首页的样子");
        const card = cardSection.createDiv("fns-cover-card-preview");
        const cardFrame = card.createDiv("fns-cover-card-frame");
        this.cardFrameEl = cardFrame;
        const cardBody = card.createDiv("fns-cover-card-body");
        cardBody.createDiv("fns-cover-card-title").setText(this.note.basename);
        cardBody.createDiv("fns-cover-card-meta").setText(this.formatDate());

        // 5. 状态说明
        this.statusEl = panel.createDiv("fns-cover-status");
        this.updateStatus();
    }

    private renderFooter(root: HTMLElement): void {
        const footer = root.createDiv("fns-cover-footer");

        const left = footer.createDiv("fns-cover-footer-left");
        if (this.hadCover) {
            const remove = left.createEl("button", { cls: "fns-cover-btn fns-cover-btn--ghost", text: "移除封面" });
            remove.addEventListener("click", () => void this.removeCover());
        }

        const right = footer.createDiv("fns-cover-footer-right");
        const cancel = right.createEl("button", { cls: "fns-cover-btn", text: "取消" });
        cancel.addEventListener("click", () => this.close());

        const save = right.createEl("button", { cls: "fns-cover-btn fns-cover-btn--primary", text: "保存" });
        save.addEventListener("click", () => void this.save());
    }

    private formatDate(): string {
        const d = new Date(this.note.stat.ctime);
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
    }

    // ── 图片加载与绘制 ─────────────────────────────────────────────────

    private async loadImage(): Promise<void> {
        this.imageReady = false;
        this.imageFailed = false;
        this.naturalWidth = 0;
        this.naturalHeight = 0;
        // Cleared up front: if the new file fails to resolve, the frame must not keep painting
        // the previous image as though the pick had worked.
        // 先清空：新文件解析失败时，框不能继续画着上一张图，让人以为更换成功了。
        this.imageSrc = "";

        if (!this.imageFile) {
            this.paint();
            return;
        }

        let src: string;
        try {
            src = this.app.vault.adapter.getResourcePath(this.imageFile.path);
        } catch {
            this.imageFailed = true;
            this.paint();
            return;
        }

        // A video cover cannot be measured through an Image element, and none of the notes in
        // this vault use one. The frame keeps its declared aspect and the panel still works, so
        // the editor degrades to "you can pick it, you cannot crop it" rather than refusing.
        // 视频封面无法用 Image 量尺寸，而这个仓库里没有一篇用到。框保持声明比例、面板照常可用，
        // 于是编辑器退化成「能选、不能裁」，而不是直接不可用。
        if (isVideoCover(this.imageFile.path)) {
            this.imageSrc = src;
            this.imageFailed = true;
            this.paint();
            return;
        }

        await new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
                this.naturalWidth = img.naturalWidth;
                this.naturalHeight = img.naturalHeight;
                this.imageReady = img.naturalWidth > 0 && img.naturalHeight > 0;
                this.imageFailed = !this.imageReady;
                this.imageSrc = src;
                resolve();
            };
            img.onerror = () => {
                this.imageFailed = true;
                this.imageSrc = src;
                resolve();
            };
            img.src = src;
        });

        this.paint();
    }

    private imageSrc = "";

    /**
     * 把当前状态画到预览与卡片上。
     *
     * 两个目标都调用同一个公式，这是有意为之：卡片预览若自己算一遍，就会出现
     * "大图看着对、小卡看着不对"的情况，而用户会认为是博客坏了。
     */
    private paint(): void {
        this.paintInto(this.frameEl);
        this.paintInto(this.cardFrameEl);

        if (this.zoomLabel) this.zoomLabel.setText(this.cover.zoom.toFixed(2) + "×");
        if (this.focusLabel) this.focusLabel.setText(`${this.cover.focusX}% ${this.cover.focusY}%`);
        if (this.zoomSlider) this.zoomSlider.value = String(Math.round(this.cover.zoom * 100));
        this.updateStatus();
    }

    private paintInto(el: HTMLElement | null): void {
        if (!el) return;
        const size = el.clientWidth;
        if (!size || !this.imageReady || !this.imageSrc) {
            el.toggleClass("is-empty", !this.imageReady);
            if (this.imageSrc) {
                el.style.backgroundImage = `url("${this.imageSrc}")`;
                el.style.backgroundSize = "cover";
                el.style.backgroundPosition = "center";
            }
            return;
        }

        // Same geometry the server produces: at zoom 1 the image exactly covers the square, and
        // every extra zoom multiplies both axes about the same scale factor. background-position
        // with percentages then means exactly what object-position means, so the crop matches.
        // 与服务端完全相同的几何：zoom 为 1 时图片正好铺满正方形，之后每一份放大都按同一比例
        // 乘在两个轴上。百分比形式的 background-position 与 object-position 语义完全一致，
        // 因此裁切结果对得上。
        const baseScale = Math.max(size / this.naturalWidth, size / this.naturalHeight);
        const scale = baseScale * clampCoverZoom(this.cover.zoom);
        el.toggleClass("is-empty", false);
        el.style.backgroundImage = `url("${this.imageSrc}")`;
        el.style.backgroundSize = `${this.naturalWidth * scale}px ${this.naturalHeight * scale}px`;
        el.style.backgroundPosition = `${clampPercent(this.cover.focusX)}% ${clampPercent(this.cover.focusY)}%`;
    }

    private updateStatus(): void {
        if (!this.statusEl) return;
        this.statusEl.empty();

        if (this.imageFile === null) {
            this.statusEl.setText("未选择封面图片时会显示占位色块。");
            return;
        }
        if (this.imageFailed) {
            this.statusEl.setText("这张图片无法预览，但仍然可以保存引用。");
            return;
        }
        if (this.hadCover) {
            this.statusEl.setText("已保存的封面，改动会写回笔记的 frontmatter。");
            return;
        }
        if (this.bodyImage && this.imageFile.path === this.bodyImage.path) {
            this.statusEl.setText("当前显示的是正文第一张图，保存后会固定在 frontmatter 里。");
            return;
        }
        this.statusEl.setText("保存后会写入笔记的 frontmatter。");
    }

    // ── 交互 ───────────────────────────────────────────────────────────

    private attachFrameInteractions(frame: HTMLElement): void {
        const onPointerDown = (ev: PointerEvent) => {
            if (ev.button !== 0 || !this.imageReady) return;
            ev.preventDefault();
            this.dragging = true;
            this.dragOriginX = ev.clientX;
            this.dragOriginY = ev.clientY;
            this.dragFocusX = this.cover.focusX;
            this.dragFocusY = this.cover.focusY;
            frame.setPointerCapture(ev.pointerId);
            frame.addClass("is-dragging");
        };

        const onPointerMove = (ev: PointerEvent) => {
            if (!this.dragging) return;
            ev.preventDefault();
            const size = frame.clientWidth;
            if (!size) return;

            const scale = Math.max(size / this.naturalWidth, size / this.naturalHeight) * this.cover.zoom;
            const overflowX = this.naturalWidth * scale - size;
            const overflowY = this.naturalHeight * scale - size;

            // Dragging right must move the image right, which means the focal point moves left
            // in percentage terms — hence the negative sign. A dimension with no overflow has no
            // focal freedom at all, so its axis is left untouched instead of being divided by 0.
            // 向右拖必须让图片向右移，也就是焦点百分比变小 —— 所以取负号。没有溢出的方向
            // 根本不存在焦点自由度，那个轴原样不动，而不是拿 0 去做除数。
            const dx = (ev.clientX - this.dragOriginX) * DRAG_SENSITIVITY;
            const dy = (ev.clientY - this.dragOriginY) * DRAG_SENSITIVITY;

            if (overflowX > 0.5) {
                this.cover.focusX = clampPercent(this.dragFocusX - (dx / overflowX) * 100);
            }
            if (overflowY > 0.5) {
                this.cover.focusY = clampPercent(this.dragFocusY - (dy / overflowY) * 100);
            }
            this.paint();
        };

        const onPointerUp = (ev: PointerEvent) => {
            if (!this.dragging) return;
            this.dragging = false;
            frame.releasePointerCapture?.(ev.pointerId);
            frame.removeClass("is-dragging");
        };

        const onWheel = (ev: WheelEvent) => {
            if (!this.imageReady) return;
            ev.preventDefault();
            this.setZoom(this.cover.zoom * (1 - ev.deltaY * WHEEL_SENSITIVITY));
        };

        const onDoubleClick = () => this.resetTransform();

        const onKeyDown = (ev: KeyboardEvent) => {
            const step = ev.shiftKey ? 10 : 2;
            switch (ev.key) {
                case "ArrowLeft":
                    this.cover.focusX = clampPercent(this.cover.focusX - step);
                    break;
                case "ArrowRight":
                    this.cover.focusX = clampPercent(this.cover.focusX + step);
                    break;
                case "ArrowUp":
                    this.cover.focusY = clampPercent(this.cover.focusY - step);
                    break;
                case "ArrowDown":
                    this.cover.focusY = clampPercent(this.cover.focusY + step);
                    break;
                case "+":
                case "=":
                    this.setZoom(this.cover.zoom + 0.1);
                    return;
                case "-":
                    this.setZoom(this.cover.zoom - 0.1);
                    return;
                default:
                    return;
            }
            ev.preventDefault();
            this.paint();
        };

        frame.addEventListener("pointerdown", onPointerDown);
        frame.addEventListener("pointermove", onPointerMove);
        frame.addEventListener("pointerup", onPointerUp);
        frame.addEventListener("pointercancel", onPointerUp);
        frame.addEventListener("wheel", onWheel, { passive: false });
        frame.addEventListener("dblclick", onDoubleClick);
        frame.addEventListener("keydown", onKeyDown);

        this.detachFrame = () => {
            frame.removeEventListener("pointerdown", onPointerDown);
            frame.removeEventListener("pointermove", onPointerMove);
            frame.removeEventListener("pointerup", onPointerUp);
            frame.removeEventListener("pointercancel", onPointerUp);
            frame.removeEventListener("wheel", onWheel);
            frame.removeEventListener("dblclick", onDoubleClick);
            frame.removeEventListener("keydown", onKeyDown);
        };
    }

    private setZoom(value: number): void {
        this.cover.zoom = clampCoverZoom(value);
        this.paint();
    }

    private resetTransform(): void {
        this.cover.zoom = 1;
        this.cover.focusX = COVER_DEFAULT_FOCUS;
        this.cover.focusY = COVER_DEFAULT_FOCUS;
        this.paint();
    }

    // ── 选图 ───────────────────────────────────────────────────────────

    private openPicker(): void {
        new CoverFilePicker(this.app, (file) => {
            this.imageFile = file;
            this.cover.ref = coverRefFor(file, this.note);
            this.render();
            void this.loadImage();
        }).open();
    }

    // ── 落盘 ───────────────────────────────────────────────────────────

    private async save(): Promise<void> {
        if (this.saving) return;
        if (!this.cover.ref) {
            new Notice("还没有选择封面图片");
            return;
        }
        this.saving = true;
        try {
            const next: BlogCover = {
                ref: this.cover.ref,
                focusX: clampPercent(this.cover.focusX),
                focusY: clampPercent(this.cover.focusY),
                zoom: clampCoverZoom(this.cover.zoom),
            };
            await this.app.fileManager.processFrontMatter(this.note, (frontmatter) => {
                writeBlogCover(frontmatter as Record<string, unknown>, next);
            });
            new Notice(`封面已保存：${next.ref}`);
            this.close();
        } catch (err) {
            console.error("[Fast Note Sync] cover save failed:", err);
            new Notice("封面保存失败，请重试");
        } finally {
            this.saving = false;
        }
    }

    private async removeCover(): Promise<void> {
        this.saving = true;
        try {
            await this.app.fileManager.processFrontMatter(this.note, (frontmatter) => {
                clearBlogCover(frontmatter as Record<string, unknown>);
            });
            new Notice("封面已移除，将回到正文第一张图");
            this.close();
        } catch (err) {
            console.error("[Fast Note Sync] cover remove failed:", err);
            new Notice("移除封面失败，请重试");
        } finally {
            this.saving = false;
        }
    }
}

/**
 * 仓库图片选择器。
 *
 * 用 FuzzySuggestModal 而不是自己搭一个文件树：Obsidian 用户已经习惯这个搜索框的
 * 模糊匹配和键盘操作，重复实现一个只会更差的版本没有意义。
 */
class CoverFilePicker extends FuzzySuggestModal<TFile> {
    private onPick: (file: TFile) => void;

    constructor(app: App, onPick: (file: TFile) => void) {
        super(app);
        this.onPick = onPick;
        this.setPlaceholder("搜索仓库里的图片…");
        this.limit = 60;
    }

    getItems(): TFile[] {
        return this.app.vault.getFiles().filter(isCoverCandidate);
    }

    getItemText(item: TFile): string {
        return item.path;
    }

    onChooseItem(item: TFile): void {
        this.onPick(item);
    }
}
