/**
 * 封面图片的格式归一。
 *
 * 为什么要把 webp 转成 png：线上封面会经过服务端的缩略图管线（Pillow 缩放到 1200px 再编码成
 * JPEG），而 webp 在那个管线里是唯一一个"能读但输出格式取决于解码器版本"的输入。把它在导入时
 * 就转成 png，后续每一环看到的都是同一种位图 —— 服务端、缩略图缓存、浏览器三者不会再因为
 * 「这个 webp 是 lossy 还是 lossless、带不带 alpha」而产生不同结果。
 *
 * 站主的要求是「只转码，不限尺寸」：不缩放、不裁剪、不降质量，换了容器就写盘。所以这里
 * 除了解码再编码之外什么都不做，宽高原样保留。
 *
 * 解码用 Electron 自带的 createImageBitmap，编码用 canvas.toBlob。两者都在 Obsidian 的渲染进程里
 * 可用，因此不必为这件事引一个 wasm 编码器进来。
 */

/** 需要在导入时转成 png 的扩展名。目前只有 webp。 */
const TRANSCODE_TO_PNG = new Set<string>(["webp"]);

/**
 * 这个扩展名的图片是否应当在导入时被转成 png。
 *
 * 只认 webp：png / jpg / jpeg 已经是终点格式，再编码一次只会损失信息，
 * 而视频封面根本不走这条路。
 */
export function shouldTranscodeToPng(ext: string): boolean {
	return TRANSCODE_TO_PNG.has(ext.toLowerCase());
}

/**
 * 把 webp 文件转成 png 字节。
 *
 * 抛错而不是静默回退到原始 webp：站主要的是 png，产出别的东西却报成功，等于让他到线上
 * 才发现封面格式没变。调用方据此提示并以原格式继续，由人决定要不要留。
 */
export async function webpToPngBuffer(file: File): Promise<ArrayBuffer> {
	const bitmap = await createImageBitmap(file);
	try {
		const canvas = document.createElement("canvas");
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			throw new Error("无法创建 2D 画布");
		}
		// 透明通道要保留：png 能存 alpha，直接 drawImage 到空白画布即可，
		// 不需要预填底色 —— 预填反而会把原本透明的封面变成一个白框。
		ctx.drawImage(bitmap, 0, 0);
		const blob = await new Promise<Blob | null>((resolve) => {
			canvas.toBlob(resolve, "image/png");
		});
		if (!blob) {
			throw new Error("PNG 编码失败");
		}
		return await blob.arrayBuffer();
	} finally {
		// ImageBitmap 持有解码后的位图，必须显式释放；一张大图不释放会一直占着内存直到 GC。
		bitmap.close();
	}
}

/** 把 `a/b/c.webp` 换成 `a/b/c.png`。没有扩展名时补一个。 */
export function toPngName(path: string): string {
	const dot = path.lastIndexOf(".");
	if (dot <= 0) {
		return `${path}.png`;
	}
	return `${path.slice(0, dot)}.png`;
}
