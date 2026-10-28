import { TFile } from "obsidian";

/**
 * 文章封面的 frontmatter 契约。
 *
 * 博客服务端按**逐行正则**读取这三个键，不按 YAML 解析：
 *
 *     cover: 牙发育-1.png
 *     cover-focus: 50% 35%
 *     cover-zoom: 1.4
 *
 * 之所以是三个平铺键而不是一个嵌套映射，是因为服务端那边一段畸形的 frontmatter
 * 只应该损失一行元数据，不应该连累整篇笔记。这里写出去的形状必须和那边读的一致，
 * 任何一方单独改动都会让封面静默失效 —— 服务端不会报错，它只是画一个占位色块。
 *
 * 值本身必须能被 `strconv.ParseFloat` 吃下去：写 "1.4x" 或者 "35%" 单值都会解析失败，
 * 然后静默退回默认值。集中在这里格式化，就是为了不让调用点各写各的。
 */

/** 服务端认识的两个轴键。改这里等于改服务端 blog_cover.go 的 fmCoverRegex。 */
export const COVER_KEY = "cover";
export const COVER_FOCUS_KEY = "cover-focus";
export const COVER_ZOOM_KEY = "cover-zoom";

/**
 * 缩放范围必须与服务端的 blogCoverMinZoom / blogCoverMaxZoom 一致。
 *
 * 服务端会把越界值夹取而不是拒绝，所以这里不一致不会报错 —— 它会让编辑器里看到
 * 的裁切和博客上显示的裁切不同，那种问题用户只能靠肉眼发现。
 */
export const COVER_MIN_ZOOM = 1;
export const COVER_MAX_ZOOM = 4;
export const COVER_DEFAULT_FOCUS = 50;

/**
 * 服务端 blogCoverExtensions 支持的类型。
 *
 * 保持同步的理由同上：这里允许选的文件，那边不认识就只剩一个占位块。
 * 分开两份而不是共享，是因为插件与服务端是两个仓库、两种语言，
 * 强行共享只能靠生成代码，而这里只有十二个字符串。
 */
export const COVER_IMAGE_EXTENSIONS = [
    "png",
    "jpg",
    "jpeg",
    "webp",
    "gif",
    "avif",
    "bmp",
    "svg",
] as const;

export const COVER_VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "m4v"] as const;

const ALL_COVER_EXTENSIONS = new Set<string>([
    ...COVER_IMAGE_EXTENSIONS,
    ...COVER_VIDEO_EXTENSIONS,
]);

/** 一张封面在编辑器里的完整状态。 */
export interface BlogCover {
    /** 指向图片/视频的仓库路径；空字符串表示没有封面。 */
    ref: string;
    /** 焦点横坐标，0–100。正方形裁切时必须保留的那个点的横向位置。 */
    focusX: number;
    /** 焦点纵坐标，0–100。 */
    focusY: number;
    /** 绘制尺寸倍数，1 表示正好铺满正方形。 */
    zoom: number;
}

export function defaultBlogCover(): BlogCover {
    return {
        ref: "",
        focusX: COVER_DEFAULT_FOCUS,
        focusY: COVER_DEFAULT_FOCUS,
        zoom: 1,
    };
}

/** 该文件能不能当封面：靠扩展名判断，与服务端同一套规则。 */
export function isCoverCandidate(file: TFile): boolean {
    return ALL_COVER_EXTENSIONS.has(file.extension.toLowerCase());
}

export function isVideoCover(ref: string): boolean {
    const ext = ref.split(".").pop()?.toLowerCase() ?? "";
    return (COVER_VIDEO_EXTENSIONS as readonly string[]).includes(ext);
}

export function clampCoverZoom(value: number): number {
    if (!Number.isFinite(value)) return 1;
    if (value < COVER_MIN_ZOOM) return COVER_MIN_ZOOM;
    if (value > COVER_MAX_ZOOM) return COVER_MAX_ZOOM;
    // Two decimals is the precision the slider can actually express; keeping more would make
    // every drag write a slightly different string into frontmatter and dirty the note.
    // 两位小数是滑块真正能表达的精度；保留更多只会让每次拖动都往 frontmatter 写入
    // 一个略有不同的字符串，把笔记标记成已修改。
    return Math.round(value * 100) / 100;
}

export function clampPercent(value: number): number {
    if (!Number.isFinite(value)) return COVER_DEFAULT_FOCUS;
    if (value < 0) return 0;
    if (value > 100) return 100;
    // Integers only: a focus of 43.7183% is not something an eye can use, and the extra digits
    // are pure noise in a frontmatter block a human may end up editing by hand.
    // 只取整数：43.7183% 的焦点不是眼睛能利用的东西，多余的数字对一段用户可能手工编辑的
    // frontmatter 来说纯粹是噪音。
    return Math.round(value);
}

/**
 * 解析焦点，兼容用户可能手写出的几种形状。
 *
 * 服务端接受 "50% 35%"、"50 35"、"50%,35%"。这里额外接受 YAML 数组 [50, 35]，
 * 因为手写 `cover-focus: [50, 35]` 很自然，而服务端会把它读成 "50, 35" 之外的
 * 字符串（YAML 的方括号留在值里）从而解析失败 —— 编辑器至少要把这种形状认出来，
 * 让用户看到真实生效的默认值，而不是看到一个假的 50/50 还以为自己写对了。
 */
export function parseFocus(raw: unknown): { x: number; y: number } | null {
    if (raw === null || raw === undefined) return null;

    if (Array.isArray(raw)) {
        if (raw.length < 2) return null;
        const x = Number(raw[0]);
        const y = Number(raw[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x: clampPercent(x), y: clampPercent(y) };
    }

    const text = String(raw).trim();
    if (!text) return null;
    const parts = text.split(/[\s,]+/).filter(Boolean);
    if (parts.length < 2) return null;
    const x = Number(parts[0].replace(/%$/, ""));
    const y = Number(parts[1].replace(/%$/, ""));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: clampPercent(x), y: clampPercent(y) };
}

/** 写回 frontmatter 的形状，必须与服务端 parseBlogCoverFocus 的入参一致。 */
export function formatFocus(x: number, y: number): string {
    return `${clampPercent(x)}% ${clampPercent(y)}%`;
}

/** 读 zoom，兼容数字与字符串（YAML 里 1.4 是数字，"1.4x" 是字符串）。 */
export function parseZoom(raw: unknown): number | null {
    if (raw === null || raw === undefined) return null;
    const text = String(raw).trim().replace(/x$/i, "");
    if (!text) return null;
    const value = Number(text);
    if (!Number.isFinite(value) || value <= 0) return null;
    return clampCoverZoom(value);
}

/**
 * 从 frontmatter 读出一张封面。
 *
 * 没有 cover 键时返回 null 而不是一个默认结构 —— 调用方需要区分「这篇没设封面」和
 * 「这篇设了封面但参数是默认值」，因为前者要在编辑器里显示"当前用正文第一张图"，
 * 后者要显示"已固定到这张图"。
 */
export function readBlogCover(frontmatter: Record<string, unknown> | null | undefined): BlogCover | null {
    if (!frontmatter) return null;
    const rawRef = frontmatter[COVER_KEY];
    if (rawRef === null || rawRef === undefined) return null;

    const ref = normalizeCoverRef(String(rawRef));
    if (!ref) return null;

    const cover = defaultBlogCover();
    cover.ref = ref;

    const focus = parseFocus(frontmatter[COVER_FOCUS_KEY]);
    if (focus) {
        cover.focusX = focus.x;
        cover.focusY = focus.y;
    }

    const zoom = parseZoom(frontmatter[COVER_ZOOM_KEY]);
    if (zoom !== null) {
        cover.zoom = zoom;
    }
    return cover;
}

/**
 * 把几张封面写进 frontmatter（就地修改传入的对象）。
 *
 * zoom 为 1 且焦点居中时不写那两个键：默认值不落盘，编辑器"移除封面"之后留下的痕迹
 * 越少越好，也让用户手写 frontmatter 时能一眼看出自己到底改了什么。
 */
export function writeBlogCover(frontmatter: Record<string, unknown>, cover: BlogCover): void {
    frontmatter[COVER_KEY] = cover.ref;

    if (cover.focusX === COVER_DEFAULT_FOCUS && cover.focusY === COVER_DEFAULT_FOCUS) {
        delete frontmatter[COVER_FOCUS_KEY];
    } else {
        frontmatter[COVER_FOCUS_KEY] = formatFocus(cover.focusX, cover.focusY);
    }

    if (clampCoverZoom(cover.zoom) === 1) {
        delete frontmatter[COVER_ZOOM_KEY];
    } else {
        frontmatter[COVER_ZOOM_KEY] = clampCoverZoom(cover.zoom);
    }
}

/** 移除封面相关的三个键。 */
export function clearBlogCover(frontmatter: Record<string, unknown>): void {
    delete frontmatter[COVER_KEY];
    delete frontmatter[COVER_FOCUS_KEY];
    delete frontmatter[COVER_ZOOM_KEY];
}

/**
 * 把 frontmatter 里可能带 Obsidian 嵌入语法的值还原成裸路径。
 *
 * 用户手写 `cover: "![[图.png]]"` 是常见写法，服务端也认。这里认出来是为了让编辑器
 * 显示正确的文件名，而不是显示 "![[图.png]]" 这个不存在的文件。
 */
export function normalizeCoverRef(raw: string): string {
    let text = raw.trim().replace(/^["']|["']$/g, "");
    const embed = /^!?\[\[([^\]]+)\]\]$/.exec(text);
    if (embed) {
        text = embed[1].split("|")[0].split("#")[0];
    }
    return text.trim();
}

/**
 * 决定写进 frontmatter 的引用写法。
 *
 * 图片与笔记同目录时只写文件名。服务端解析顺序是先按笔记目录拼路径精确匹配，
 * 再退回后缀查询 + 「与笔记共享最长目录前缀」的邻近择一；写成裸文件名能让第一步直接命中，
 * 绕开第二步里同名的歧义。放在别的目录时必须写完整仓库路径，否则那一步查不到。
 */
export function coverRefFor(image: TFile, note: TFile): string {
    if (image.parent && note.parent && image.parent.path === note.parent.path) {
        return image.name;
    }
    return image.path;
}
